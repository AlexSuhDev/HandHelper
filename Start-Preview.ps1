param([ValidateRange(1024, 65535)][int]$Port = 8741)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$mime = @{ '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.md' = 'text/plain; charset=utf-8' }
$listener.Start()
Write-Output "HandHelper: http://127.0.0.1:$Port/ (Ctrl+C to stop)"
try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 3000
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $request = $reader.ReadLine()
            $headerBytes = 0
            do {
                $line = $reader.ReadLine()
                if ($null -ne $line) { $headerBytes += $line.Length }
                if ($headerBytes -gt 16384) { throw 'Headers too large' }
            } while ($null -ne $line -and $line.Length -gt 0)
            $status = '200 OK'
            $type = 'text/plain; charset=utf-8'
            $body = [Text.Encoding]::UTF8.GetBytes('Not found')
            if ($request -match '^(GET|HEAD) ([^ ]+) HTTP/1\.[01]$') {
                $method = $Matches[1]
                $urlPath = [Uri]::UnescapeDataString(($Matches[2] -split '\?')[0])
                $relative = $urlPath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
                if ([string]::IsNullOrEmpty($relative)) { $relative = 'index.html' }
                $path = [IO.Path]::GetFullPath([IO.Path]::Combine($projectRoot, $relative))
                if ([IO.Directory]::Exists($path)) { $path = [IO.Path]::Combine($path, 'index.html') }
                $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
                $allowedRoute = $relative -in @('index.html', 'styles.css', 'README.md') -or $relative -match '^(js|tests)[\\/]'
                if ($allowedRoute -and $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -and $mime.ContainsKey($extension) -and [IO.File]::Exists($path)) {
                    $body = [IO.File]::ReadAllBytes($path)
                    $type = $mime[$extension]
                } else { $status = '404 Not Found' }
            } else { $status = '405 Method Not Allowed'; $method = 'GET' }
            $header = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
            $headerData = [Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerData, 0, $headerData.Length)
            if ($method -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
            $stream.Flush()
        } catch { Write-Verbose $_.Exception.Message }
        finally { $client.Dispose() }
    }
} finally { $listener.Stop() }
