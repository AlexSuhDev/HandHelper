param([switch]$WithBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path $projectRoot ('.qa/server-fixture-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
foreach ($folder in @('js', 'tests')) {
    [IO.Directory]::CreateDirectory((Join-Path $fixtureRoot $folder)) | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $projectRoot $folder) -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $fixtureRoot $folder) }
}
foreach ($name in @('index.html', 'styles.css', 'README.md')) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $fixtureRoot $name) }
$testPassword = 'FixtureOnly-Password-2026!'
$fixtureTests = Join-Path $fixtureRoot 'tests/index.html'
$testHtml = [IO.File]::ReadAllText($fixtureTests).Replace('<script defer src="tests.js">', '<script>window.__HH_TEST_ADMIN_PASSWORD="FixtureOnly-Password-2026!";</script><script defer src="tests.js">')
[IO.File]::WriteAllText($fixtureTests, $testHtml, [Text.UTF8Encoding]::new($false))
Add-Type -Path (Join-Path $projectRoot 'server/HandHelperServer.cs') -ReferencedAssemblies System.Web.Extensions, System.Core
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $probe.Start(); $port = $probe.LocalEndpoint.Port; $probe.Stop()
$baseUri = "http://127.0.0.1:$port"
$server = [HandHelper.PortalServer]::new($fixtureRoot, $port); $server.Initialize($testPassword) | Out-Null; $server.StartBackground()
$script:checks = 0
function Assert-Check([bool]$Condition, [string]$Name) { if (-not $Condition) { throw "FAIL $Name" }; $script:checks++; Write-Output "PASS $Name" }
function Request([string]$Method, [string]$Path, $Body = $null, $CookieJar = $null, $Headers = @{}) {
    $request = [Net.HttpWebRequest]::Create($baseUri + $Path); $request.Method = $Method; $request.Timeout = 10000; $request.Proxy = $null
    $request.Headers['Origin'] = $baseUri
    if ($CookieJar) { $request.CookieContainer = $CookieJar }
    foreach ($name in $Headers.Keys) { $request.Headers[$name] = $Headers[$name] }
    if ($null -ne $Body) { $payload = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10 -Compress)); $request.ContentType = 'application/json'; $request.ContentLength = $payload.Length; $stream = $request.GetRequestStream(); $stream.Write($payload, 0, $payload.Length); $stream.Dispose() }
    try { $response = $request.GetResponse() } catch [Net.WebException] { if (-not $_.Exception.Response) { throw }; $response = $_.Exception.Response }
    $reader = [IO.StreamReader]::new($response.GetResponseStream()); $text = $reader.ReadToEnd(); $reader.Dispose()
    $result = @{ Status = [int]$response.StatusCode; Headers = $response.Headers; Text = $text; Data = $null }
    try { $result.Data = $text | ConvertFrom-Json } catch {}
    $response.Dispose(); return $result
}
try {
    $public = Request GET '/api/auth/session'; Assert-Check (-not $public.Data.authenticated) 'Public session is not administrator'
    Assert-Check ((Request GET '/api/admin/statistics').Status -eq 401) 'Statistics API rejects anonymous visitors'
    Assert-Check ((Request GET '/api/admin/statistics?role=admin').Status -eq 401) 'URL parameter cannot grant access'
    Assert-Check ((Request GET '/.data/admin.json').Status -eq 404) 'Credential file is not publicly served'
    Assert-Check ((Request GET '/js/../.data/statistics.json').Status -eq 404) 'Traversal cannot read private statistics'
    $credentials = [IO.File]::ReadAllText((Join-Path $fixtureRoot '.data/admin.json'))
    Assert-Check (-not $credentials.Contains($testPassword)) 'Only a salted password hash is stored'
    Assert-Check ((Request POST '/api/auth/login' @{ username = 'admin'; password = 'incorrect-password' }).Status -eq 401) 'Incorrect password is rejected'
    $cookies = [Net.CookieContainer]::new()
    $login = Request POST '/api/auth/login' @{ username = 'admin'; password = $testPassword } $cookies
    Assert-Check ($login.Status -eq 200 -and $login.Data.authenticated) 'Correct credentials create a session'
    Assert-Check ($login.Headers['Set-Cookie'] -match 'HttpOnly' -and $login.Headers['Set-Cookie'] -match 'SameSite=Strict') 'Administrator cookie is HttpOnly and SameSite Strict'
    Assert-Check ((Request GET '/api/auth/session' $null $cookies).Data.authenticated) 'Session survives page requests'
    Assert-Check ((Request GET '/api/admin/statistics?range=invalid' $null $cookies).Status -eq 400) 'Invalid statistics period is rejected'
    Assert-Check ((Request POST '/api/auth/logout' @{} $cookies).Status -eq 403) 'Logout requires a CSRF token'
    Assert-Check ((Request POST '/api/auth/login' @{ username = 'admin'; password = $testPassword } $null @{ Origin = 'https://foreign.invalid' }).Status -eq 403) 'Cross-origin state changes are rejected'
    $entry = Request POST '/api/statistics/sessions' @{}
    $tokenHeaders = @{ 'X-Statistics-Token' = $entry.Data.token }
    $counters = @{}; foreach ($name in @('requestsCreated', 'requestsDeleted', 'statusChanges', 'favorites', 'services', 'offerShown', 'offerAccepted', 'offerDeclined', 'level1', 'level2', 'level3')) { $counters[$name] = 0 }
    $counters.requestsCreated = 2; $counters.services = 3; $counters.offerShown = 1; $counters.offerAccepted = 1; $counters.level2 = 1
    $payload = @{ activeSeconds = 120; keydowns = 80; clicks = 25; counters = $counters; title = 'PRIVATE TEXT MUST NOT BE STORED' }
    Assert-Check ((Request POST '/api/statistics/update' $payload $null $tokenHeaders).Status -eq 200) 'Numeric snapshots are accepted with the session token'
    Assert-Check ((Request POST '/api/statistics/update' $payload).Status -eq 401) 'Statistics cannot be updated without its token'
    $summary = (Request GET '/api/admin/statistics?range=7' $null $cookies).Data
    Assert-Check ($summary.sessions -eq 1 -and $summary.activeSeconds -eq 120 -and $summary.keydowns -eq 80 -and $summary.clicks -eq 25 -and $summary.totals.requestsCreated -eq 2) 'Dashboard totals match saved visitor data'
    Assert-Check ($summary.trend.Count -eq 7 -and $summary.recent.Count -eq 1 -and $summary.totals.level2 -eq 1) 'Dashboard supplies daily series and recent sessions'
    $persisted = [IO.File]::ReadAllText((Join-Path $fixtureRoot '.data/statistics.json'))
    Assert-Check (-not $persisted.Contains('PRIVATE TEXT') -and -not $persisted.Contains($entry.Data.token)) 'Text and raw statistics tokens are never persisted'
    $payload.activeSeconds = 10; Request POST '/api/statistics/update' $payload $null $tokenHeaders | Out-Null
    Assert-Check ((Request GET '/api/admin/statistics' $null $cookies).Data.activeSeconds -eq 120) 'Late snapshots cannot decrease counters'
    $payload.activeSeconds = -1; Assert-Check ((Request POST '/api/statistics/update' $payload $null $tokenHeaders).Status -eq 400) 'Negative counters are rejected'
    $payload.activeSeconds = 12.5; Assert-Check ((Request POST '/api/statistics/update' $payload $null $tokenHeaders).Status -eq 400) 'Fractional time is rejected'
    $server.Dispose()
    $server = [HandHelper.PortalServer]::new($fixtureRoot, $port); $server.Initialize($null) | Out-Null; $server.StartBackground()
    Assert-Check ((Request GET '/api/admin/statistics' $null $cookies).Status -eq 401) 'Server restart expires old administrator sessions'
    $login = Request POST '/api/auth/login' @{ username = 'admin'; password = $testPassword } $cookies
    $restored = (Request GET '/api/admin/statistics' $null $cookies).Data
    Assert-Check ($restored.sessions -eq 1 -and $restored.keydowns -eq 80) 'Saved statistics and credentials survive server restart'
    Assert-Check ((Request POST '/api/statistics/revoke' @{} $null $tokenHeaders).Data.deleted) 'Revoking consent deletes the numeric session'
    Assert-Check ((Request POST '/api/statistics/revoke' @{} $null $tokenHeaders).Data.deleted) 'Retrying consent revocation is safe after a lost response'
    Assert-Check ((Request GET '/api/admin/statistics' $null $cookies).Data.sessions -eq 0) 'Revoked data disappears from administrator statistics'
    Assert-Check ((Request POST '/api/auth/logout' @{} $cookies @{ 'X-CSRF-Token' = $login.Data.csrfToken }).Status -eq 200) 'Logout invalidates the server session'
    Assert-Check ((Request GET '/api/admin/statistics' $null $cookies).Status -eq 401) 'Logged-out administrator cannot retrieve statistics'
    for ($attempt = 0; $attempt -lt 5; $attempt++) { Request POST '/api/auth/login' @{ username = 'admin'; password = 'incorrect-password' } | Out-Null }
    Assert-Check ((Request POST '/api/auth/login' @{ username = 'admin'; password = $testPassword }).Status -eq 429) 'Repeated incorrect passwords temporarily block further login attempts'
    $server.Dispose()
    $server = [HandHelper.PortalServer]::new($fixtureRoot, $port); $server.Initialize($null) | Out-Null; $server.StartBackground()
    Write-Output "$script:checks server checks passed"
    if ($WithBrowser) {
        $browserPath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
        $outputPath = Join-Path $fixtureRoot 'browser-results.html'
        $profilePath = Join-Path $fixtureRoot 'browser-profile'
        $browser = Start-Process -FilePath $browserPath -ArgumentList @('--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', "--user-data-dir=$profilePath", '--virtual-time-budget=30000', '--dump-dom', "$baseUri/tests/index.html") -WindowStyle Hidden -PassThru -RedirectStandardOutput $outputPath -RedirectStandardError (Join-Path $fixtureRoot 'browser-errors.log')
        if (-not $browser.WaitForExit(30000)) { throw 'Browser checks timed out' }
        $output = ''
        for ($attempt = 0; $attempt -lt 100; $attempt++) {
            $output = Get-Content -LiteralPath $outputPath -Raw -Encoding UTF8
            if ($output -match 'data-test-status="(passed|failed)"') { break }
            Start-Sleep -Milliseconds 200
        }
        if ($output -notmatch 'data-test-status="passed"') { Write-Output $output; throw 'Browser checks failed' }
        [regex]::Matches($output, '\d+ passed, \d+ failed') | ForEach-Object { Write-Output $_.Value }
    }
} finally { $server.Dispose() }
