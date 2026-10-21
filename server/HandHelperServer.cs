using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace HandHelper {
    public sealed class PortalServer : IDisposable {
        private readonly string root, dataRoot;
        private readonly int port;
        private readonly TcpListener listener;
        private readonly object gate = new object();
        private readonly Semaphore slots = new Semaphore(16, 16);
        private readonly Dictionary<string, LoginSession> logins = new Dictionary<string, LoginSession>();
        private readonly Dictionary<string, StatisticsSession> statistics = new Dictionary<string, StatisticsSession>();
        private Credential credential;
        private int failedLogins, sessionsThisMinute;
        private DateTime blockedUntil, creationMinute;
        private bool stopped;
        private static readonly string[] CounterNames = { "requestsCreated", "requestsDeleted", "statusChanges", "favorites", "services", "offerShown", "offerAccepted", "offerDeclined", "level1", "level2", "level3" };
        private static readonly string[] PublicFiles = { "index.html", "styles.css", "README.md" };

        public PortalServer(string rootPath, int serverPort) {
            root = Path.GetFullPath(rootPath); dataRoot = Path.Combine(root, ".data"); port = serverPort;
            listener = new TcpListener(IPAddress.Loopback, port);
        }
        public string Initialize(string password) {
            Directory.CreateDirectory(dataRoot);
            string credentialPath = Path.Combine(dataRoot, "admin.json"), initialPassword = null;
            if (!File.Exists(credentialPath) || !String.IsNullOrEmpty(password)) {
                if (String.IsNullOrEmpty(password)) password = initialPassword = RandomToken(18);
                if (password.Length < 5 || password.Length > 256) throw new ArgumentException("Administrator password must contain 5 to 256 characters.");
                var salt = RandomBytes(24);
                credential = new Credential { Username = "admin", Salt = Convert.ToBase64String(salt), Iterations = 210000 };
                credential.Hash = Convert.ToBase64String(HashPassword(password, salt, credential.Iterations));
                WriteJson(credentialPath, credential);
            } else credential = Json().Deserialize<Credential>(File.ReadAllText(credentialPath, Encoding.UTF8));
            if (credential == null || credential.Iterations < 100000 || credential.Username != "admin") throw new InvalidDataException("Invalid administrator configuration.");
            Convert.FromBase64String(credential.Salt); Convert.FromBase64String(credential.Hash);
            string statisticsPath = Path.Combine(dataRoot, "statistics.json");
            if (File.Exists(statisticsPath)) {
                var saved = Json().Deserialize<List<StatisticsSession>>(File.ReadAllText(statisticsPath, Encoding.UTF8));
                foreach (var row in saved) statistics[row.TokenHash] = row;
            }
            return initialPassword;
        }
        public void Run() {
            listener.Start();
            while (!stopped) {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); } catch (SocketException) { if (stopped) break; throw; }
                if (!slots.WaitOne(0)) { client.Close(); continue; }
                ThreadPool.QueueUserWorkItem(delegate {
                    try { Handle(client); } catch { /* A disconnected or malformed request cannot stop the server. */ }
                    finally { client.Close(); slots.Release(); }
                });
            }
        }
        public void StartBackground() { var worker = new Thread(Run); worker.IsBackground = true; worker.Start(); }
        public void Dispose() { stopped = true; listener.Stop(); }
        private void Handle(TcpClient client) {
            client.ReceiveTimeout = 5000; client.SendTimeout = 5000;
            var stream = client.GetStream();
            try {
                var request = ReadRequest(stream);
                var allowedHosts = new[] { "127.0.0.1:" + port, "localhost:" + port };
                if (!allowedHosts.Contains(request.Header("Host"), StringComparer.OrdinalIgnoreCase)) { Send(stream, 403, new { error = "Invalid host." }); return; }
                if (request.Method == "POST" && !allowedHosts.Any(host => request.Header("Origin") == "http://" + host)) { Send(stream, 403, new { error = "Invalid origin." }); return; }
                if (request.Path.StartsWith("/api/", StringComparison.Ordinal)) {
                    lock (gate) { Api(request, stream); }
                } else ServeFile(request, stream);
            } catch (RequestException error) { Send(stream, error.Status, new { error = error.Message }); }
            catch { Send(stream, 500, new { error = "Server could not complete the request." }); }
        }
        private void Api(Request request, Stream stream) {
            DateTime now = DateTime.UtcNow;
            foreach (string key in logins.Where(pair => pair.Value.Expires <= now).Select(pair => pair.Key).ToArray()) logins.Remove(key);
            string cookie = Cookie(request.Header("Cookie"), "hh_admin");
            LoginSession session; logins.TryGetValue(cookie ?? "", out session);
            if (request.Path == "/api/auth/session" && request.Method == "GET") {
                Send(stream, 200, new { authenticated = session != null, username = session == null ? null : "admin", csrfToken = session == null ? null : session.Csrf }); return;
            }
            if (request.Path == "/api/auth/login" && request.Method == "POST") {
                if (now < blockedUntil) { Send(stream, 429, new { error = "Too many attempts. Try again in five minutes." }); return; }
                var body = ReadJson(request);
                string username = Text(body, "username"), password = Text(body, "password");
                if (password.Length > 256) { Send(stream, 400, new { error = "Invalid credentials." }); return; }
                byte[] candidate = HashPassword(password, Convert.FromBase64String(credential.Salt), credential.Iterations);
                bool valid = Equal(candidate, Convert.FromBase64String(credential.Hash)) && username == credential.Username;
                if (!valid) {
                    failedLogins++; if (failedLogins >= 5) { blockedUntil = now.AddMinutes(5); failedLogins = 0; }
                    Send(stream, 401, new { error = "Incorrect username or password." }); return;
                }
                failedLogins = 0;
                if (session != null) logins.Remove(cookie);
                if (logins.Count >= 100) { Send(stream, 429, new { error = "Too many active sessions." }); return; }
                string token = RandomToken(32);
                session = new LoginSession { Csrf = RandomToken(32), Expires = now.AddHours(1) }; logins[token] = session;
                Send(stream, 200, new { authenticated = true, username = "admin", csrfToken = session.Csrf }, "hh_admin=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600"); return;
            }
            if (request.Path.StartsWith("/api/admin/", StringComparison.Ordinal) || request.Path == "/api/auth/logout") {
                if (session == null) { Send(stream, 401, new { error = "Administrator login required." }); return; }
                if (request.Method == "POST" && request.Header("X-CSRF-Token") != session.Csrf) { Send(stream, 403, new { error = "Invalid session token." }); return; }
            }
            if (request.Path == "/api/auth/logout" && request.Method == "POST") {
                logins.Remove(cookie); Send(stream, 200, new { authenticated = false }, "hh_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); return;
            }
            if (request.Path == "/api/admin/statistics" && request.Method == "GET") {
                string range = request.Query.ContainsKey("range") ? request.Query["range"] : "7";
                if (range != "7" && range != "30" && range != "all") { Send(stream, 400, new { error = "Invalid period." }); return; }
                DateTime start = range == "all" ? DateTime.MinValue : now.Date.AddDays(1 - Int32.Parse(range, CultureInfo.InvariantCulture));
                var rows = statistics.Values.Where(row => DateTime.Parse(row.StartedAt, null, DateTimeStyles.RoundtripKind) >= start).OrderByDescending(row => row.UpdatedAt).ToArray();
                var totals = CounterNames.ToDictionary(name => name, name => rows.Sum(row => (long)row.Counters[name]));
                int days = range == "all" ? 30 : Int32.Parse(range, CultureInfo.InvariantCulture);
                var trend = Enumerable.Range(0, days).Select(offset => {
                    string date = now.Date.AddDays(offset - days + 1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                    var daily = rows.Where(row => row.StartedAt.StartsWith(date, StringComparison.Ordinal)).ToArray();
                    return new { date, sessions = daily.Length, requests = daily.Sum(row => (long)row.Counters["requestsCreated"]), accepted = daily.Sum(row => (long)row.Counters["offerAccepted"]) };
                }).ToArray();
                Send(stream, 200, new {
                    generatedAt = now.ToString("o"), range, sessions = rows.Length,
                    activeSeconds = rows.Sum(row => (long)row.ActiveSeconds), keydowns = rows.Sum(row => (long)row.Keydowns), clicks = rows.Sum(row => (long)row.Clicks), totals, trend,
                    recent = rows.Take(50).Select(row => new { id = row.Id, startedAt = row.StartedAt, updatedAt = row.UpdatedAt, activeSeconds = row.ActiveSeconds, keydowns = row.Keydowns, clicks = row.Clicks, requestsCreated = row.Counters["requestsCreated"], offerAccepted = row.Counters["offerAccepted"] }).ToArray()
                }); return;
            }
            if (request.Path == "/api/statistics/sessions" && request.Method == "POST") {
                if (creationMinute.AddMinutes(1) < now) { creationMinute = now; sessionsThisMinute = 0; }
                if (++sessionsThisMinute > 120 || statistics.Count >= 10000) { Send(stream, 429, new { error = "Statistics capacity reached." }); return; }
                string token = RandomToken(32), hash = TokenHash(token);
                var entry = new StatisticsSession { TokenHash = hash, Id = Guid.NewGuid().ToString("N").Substring(0, 12), StartedAt = now.ToString("o"), UpdatedAt = now.ToString("o"), Counters = CounterNames.ToDictionary(name => name, name => 0) };
                statistics[hash] = entry;
                try { SaveStatistics(); } catch { statistics.Remove(hash); throw; }
                Send(stream, 201, new { token, id = entry.Id }); return;
            }
            if ((request.Path == "/api/statistics/update" || request.Path == "/api/statistics/revoke") && request.Method == "POST") {
                string hash = TokenHash(request.Header("X-Statistics-Token")); StatisticsSession entry;
                if (!statistics.TryGetValue(hash, out entry)) {
                    if (request.Path.EndsWith("/revoke", StringComparison.Ordinal) && request.Header("X-Statistics-Token").Length >= 32) { Send(stream, 200, new { deleted = true }); return; }
                    Send(stream, 401, new { error = "Statistics session not found." }); return;
                }
                if (request.Path.EndsWith("/revoke", StringComparison.Ordinal)) {
                    statistics.Remove(hash);
                    try { SaveStatistics(); } catch { statistics[hash] = entry; throw; }
                    Send(stream, 200, new { deleted = true }); return;
                }
                var body = ReadJson(request);
                int activeSeconds = Number(body, "activeSeconds", 3600), keydowns = Number(body, "keydowns", 10000000), clicks = Number(body, "clicks", 10000000);
                var counters = body.ContainsKey("counters") ? body["counters"] as Dictionary<string, object> : null;
                if (counters == null) throw new RequestException(400, "Counters required.");
                var nextCounters = CounterNames.ToDictionary(name => name, name => Math.Max(entry.Counters[name], Number(counters, name, 1000000)));
                entry.ActiveSeconds = Math.Max(entry.ActiveSeconds, activeSeconds); entry.Keydowns = Math.Max(entry.Keydowns, keydowns); entry.Clicks = Math.Max(entry.Clicks, clicks);
                entry.Counters = nextCounters; entry.UpdatedAt = now.ToString("o"); SaveStatistics();
                Send(stream, 200, new { saved = true }); return;
            }
            Send(stream, 404, new { error = "Endpoint not found." });
        }
        private void ServeFile(Request request, Stream stream) {
            if (request.Method != "GET" && request.Method != "HEAD") { Send(stream, 405, new { error = "Method not allowed." }); return; }
            string relative = request.Path.TrimStart('/'); if (relative == "") relative = "index.html";
            string path = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
            string extension = Path.GetExtension(path).ToLowerInvariant();
            bool allowed = PublicFiles.Contains(relative) || relative.StartsWith("js/", StringComparison.Ordinal) || relative.StartsWith("tests/", StringComparison.Ordinal);
            var types = new Dictionary<string, string> { { ".html", "text/html; charset=utf-8" }, { ".css", "text/css; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".md", "text/plain; charset=utf-8" } };
            if (!allowed || !path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !types.ContainsKey(extension) || !File.Exists(path)) { Send(stream, 404, new { error = "File not found." }); return; }
            SendBytes(stream, 200, File.ReadAllBytes(path), types[extension], null, request.Method == "HEAD");
        }
        private static Request ReadRequest(Stream stream) {
            var header = new List<byte>(); int b;
            while ((b = stream.ReadByte()) >= 0) {
                header.Add((byte)b); int n = header.Count;
                if (n > 16384) throw new RequestException(431, "Headers too large.");
                if (n >= 4 && header[n - 4] == 13 && header[n - 3] == 10 && header[n - 2] == 13 && header[n - 1] == 10) break;
            }
            var lines = Encoding.ASCII.GetString(header.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
            var first = lines[0].Split(' ');
            if (first.Length != 3 || !first[2].StartsWith("HTTP/1.", StringComparison.Ordinal) || !first[1].StartsWith("/", StringComparison.Ordinal)) throw new RequestException(400, "Invalid request.");
            var result = new Request { Method = first[0] };
            foreach (string line in lines.Skip(1).Where(line => line.Length > 0)) {
                int colon = line.IndexOf(':'); if (colon <= 0) throw new RequestException(400, "Invalid header.");
                string key = line.Substring(0, colon), value = line.Substring(colon + 1).Trim();
                if (result.Headers.ContainsKey(key)) throw new RequestException(400, "Duplicate header."); result.Headers[key] = value;
            }
            if (result.Header("Transfer-Encoding") != "") throw new RequestException(400, "Chunked requests are not supported.");
            int length = 0;
            if (result.Header("Content-Length") != "" && (!Int32.TryParse(result.Header("Content-Length"), out length) || length < 0)) throw new RequestException(400, "Invalid content length.");
            if (length > 65536) throw new RequestException(413, "Body too large.");
            byte[] body = new byte[length]; int position = 0;
            while (position < length) { int count = stream.Read(body, position, length - position); if (count == 0) throw new RequestException(400, "Incomplete body."); position += count; }
            result.Body = Encoding.UTF8.GetString(body);
            int question = first[1].IndexOf('?'); string route = question < 0 ? first[1] : first[1].Substring(0, question);
            try { result.Path = Uri.UnescapeDataString(route); } catch { throw new RequestException(400, "Invalid path."); }
            if (result.Path.Contains("\\") || result.Path.Contains("\0")) throw new RequestException(400, "Invalid path.");
            if (question >= 0) foreach (string part in first[1].Substring(question + 1).Split('&')) {
                string[] pair = part.Split(new[] { '=' }, 2); result.Query[pair[0]] = pair.Length > 1 ? pair[1] : "";
            }
            return result;
        }
        private static Dictionary<string, object> ReadJson(Request request) {
            if (!request.Header("Content-Type").StartsWith("application/json", StringComparison.OrdinalIgnoreCase)) throw new RequestException(415, "JSON required.");
            try { var body = Json().Deserialize<Dictionary<string, object>>(request.Body); if (body == null) throw new Exception(); return body; } catch { throw new RequestException(400, "Invalid JSON."); }
        }
        private static string Text(Dictionary<string, object> body, string key) { object value; return body.TryGetValue(key, out value) && value is string ? (string)value : ""; }
        private static int Number(Dictionary<string, object> body, string key, int maximum) {
            object value; if (!body.TryGetValue(key, out value) || !(value is int) || (int)value < 0 || (int)value > maximum) throw new RequestException(400, "Invalid counter: " + key);
            return (int)value;
        }
        private static JavaScriptSerializer Json() { return new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 }; }
        private void SaveStatistics() { WriteJson(Path.Combine(dataRoot, "statistics.json"), statistics.Values.ToArray()); }
        private static void WriteJson(string path, object value) {
            string temporary = path + ".tmp"; File.WriteAllText(temporary, Json().Serialize(value), new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
        }
        private static byte[] RandomBytes(int count) { byte[] result = new byte[count]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(result); return result; }
        private static string RandomToken(int count) { return Convert.ToBase64String(RandomBytes(count)).TrimEnd('=').Replace('+', '-').Replace('/', '_'); }
        private static string TokenHash(string token) { using (var sha = SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(token))); }
        private static byte[] HashPassword(string password, byte[] salt, int iterations) { using (var derive = new Rfc2898DeriveBytes(password, salt, iterations, HashAlgorithmName.SHA256)) return derive.GetBytes(32); }
        private static bool Equal(byte[] left, byte[] right) { int difference = left.Length ^ right.Length; for (int i = 0; i < Math.Min(left.Length, right.Length); i++) difference |= left[i] ^ right[i]; return difference == 0; }
        private static string Cookie(string cookies, string name) { foreach (string part in cookies.Split(';')) { string[] pair = part.Trim().Split(new[] { '=' }, 2); if (pair.Length == 2 && pair[0] == name) return pair[1]; } return null; }
        private static void Send(Stream stream, int status, object body, string cookie = null) { SendBytes(stream, status, Encoding.UTF8.GetBytes(Json().Serialize(body)), "application/json; charset=utf-8", cookie, false); }
        private static void SendBytes(Stream stream, int status, byte[] body, string type, string cookie, bool head) {
            string reason = status < 400 ? "OK" : "Error";
            string headers = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: SAMEORIGIN\r\nReferrer-Policy: same-origin\r\nConnection: close\r\n";
            if (cookie != null) headers += "Set-Cookie: " + cookie + "\r\n";
            byte[] prefix = Encoding.ASCII.GetBytes(headers + "\r\n"); stream.Write(prefix, 0, prefix.Length); if (!head) stream.Write(body, 0, body.Length); stream.Flush();
        }
        private sealed class Request {
            public string Method, Path, Body;
            public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public Dictionary<string, string> Query = new Dictionary<string, string>();
            public string Header(string name) { string value; return Headers.TryGetValue(name, out value) ? value : ""; }
        }
        private sealed class RequestException : Exception { public int Status; public RequestException(int status, string message) : base(message) { Status = status; } }
        private sealed class LoginSession { public string Csrf; public DateTime Expires; }
        public sealed class Credential { public string Username { get; set; } public string Salt { get; set; } public string Hash { get; set; } public int Iterations { get; set; } }
        public sealed class StatisticsSession {
            public string TokenHash { get; set; } public string Id { get; set; } public string StartedAt { get; set; } public string UpdatedAt { get; set; }
            public int ActiveSeconds { get; set; } public int Keydowns { get; set; } public int Clicks { get; set; } public Dictionary<string, int> Counters { get; set; }
        }
    }
}
