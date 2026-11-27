<#
  링크 저장소 PC 도우미
  - 웹 앱 대기열(queue 시트)에 올라온 YouTube 영상을 yt-dlp로 받아 구글 드라이브 폴더에 올립니다.
  - 드라이브 업로드 주소는 GAS가 만들어 주고, 구글 계정 토큰은 이 PC에 저장하지 않습니다.
  - 비밀 키(API_KEY)는 Windows 사용자 계정으로 암호화해 key.dat에 저장합니다(DPAPI).

  처음 한 번:  powershell -ExecutionPolicy Bypass -File LinkSaverHelper.ps1 -Setup
  한 번 실행:  powershell -ExecutionPolicy Bypass -File LinkSaverHelper.ps1
#>
param(
  [switch]$Setup,           # 비밀 키 입력 + 5분마다 자동 실행 등록
  [switch]$Unregister       # 자동 실행 해제
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Here       = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Here 'config.json'
$KeyPath    = Join-Path $Here 'key.dat'
$LogPath    = Join-Path $Here 'helper.log'
$WorkDir    = Join-Path $Here 'work'
$TaskName   = 'LinkSaverHelper'
$ChunkSize  = 32MB   # 256KiB의 배수여야 합니다

function Write-Log([string]$Message) {
  $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Get-Config {
  if (-not (Test-Path $ConfigPath)) { throw "config.json이 없습니다: $ConfigPath" }
  return Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-ApiKey {
  if (-not (Test-Path $KeyPath)) { throw '비밀 키가 없습니다. -Setup으로 먼저 설정해 주세요.' }
  $secure = Get-Content $KeyPath -Raw | ConvertTo-SecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Find-Tool([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $links = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\$Name.exe"
  if (Test-Path $links) { return $links }
  return $null
}

# GAS 웹 앱 호출 (본문은 UTF-8 JSON, 302 넘김은 자동으로 따라갑니다)
function Invoke-Api([string]$Action, [hashtable]$Data = @{}) {
  $payload = @{ action = $Action; key = $script:ApiKey }
  foreach ($k in $Data.Keys) { $payload[$k] = $Data[$k] }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 5 -Compress))

  $req = [Net.HttpWebRequest]::Create($script:Config.apiUrl)
  $req.Method = 'POST'
  $req.ContentType = 'text/plain; charset=utf-8'
  $req.AllowAutoRedirect = $true
  $req.Timeout = 360000
  $req.ContentLength = $bytes.Length
  $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  $resp = $req.GetResponse()
  try {
    $reader = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
  } finally { $resp.Close() }

  try { $json = $text | ConvertFrom-Json } catch { throw "서버 응답을 읽지 못했습니다: $($text.Substring(0, [Math]::Min(200, $text.Length)))" }
  if (-not $json.ok) { throw "서버 오류: $($json.error)" }
  return $json
}

# 드라이브 이어 올리기 세션에 파일을 조각내어 올립니다
function Send-ToDrive([string]$Path, [string]$Name, [string]$JobId) {
  $size = (Get-Item -LiteralPath $Path).Length
  $session = (Invoke-Api 'uploadSession' @{ id = $JobId; name = $Name; mime = 'video/mp4'; size = $size }).session

  $fs = [IO.File]::OpenRead($Path)
  try {
    $buf = New-Object byte[] $ChunkSize
    $start = [int64]0
    while ($start -lt $size) {
      $n = 0
      while ($n -lt $ChunkSize) {
        $r = $fs.Read($buf, $n, $ChunkSize - $n)
        if ($r -le 0) { break }
        $n += $r
      }
      $end = $start + $n - 1

      $req = [Net.HttpWebRequest]::Create($session)
      $req.Method = 'PUT'
      $req.ContentLength = $n
      $req.AllowWriteStreamBuffering = $false
      $req.AllowAutoRedirect = $false
      $req.Timeout = 900000
      $req.ReadWriteTimeout = 900000
      $req.Headers.Add('Content-Range', "bytes $start-$end/$size")
      $rs = $req.GetRequestStream(); $rs.Write($buf, 0, $n); $rs.Close()

      $code = 0; $body = ''; $range = $null
      try { $resp = $req.GetResponse() }
      catch [Net.WebException] { $resp = $_.Exception.Response; if (-not $resp) { throw } }
      try {
        $code = [int]$resp.StatusCode
        $range = $resp.Headers['Range']
        $body = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
      } finally { $resp.Close() }

      if ($code -eq 200 -or $code -eq 201) { return ($body | ConvertFrom-Json) }
      if ($code -ne 308) { throw "드라이브 업로드 실패 (HTTP $code): $body" }

      # 308: 서버가 받은 마지막 바이트(Range: bytes=0-N) 다음부터 이어서 보냅니다
      if ($range -match 'bytes=0-(\d+)') { $next = [int64]$Matches[1] + 1 } else { $next = $end + 1 }
      if ($next -ne $end + 1) { $fs.Seek($next, 'Begin') | Out-Null }
      $start = $next
      Write-Log ("  업로드 {0:N0} / {1:N0} MB" -f ($start / 1MB), ($size / 1MB))
    }
  } finally { $fs.Close() }
  throw '업로드가 끝나지 않았습니다.'
}

function Get-SafeName([string]$Title, [string]$Url) {
  $id = if ($Url -match 'v=([\w-]{11})') { $Matches[1] } else { 'video' }
  $t = if ($Title) { $Title } else { 'YouTube' }
  $t = ($t -replace '[\\/:*?"<>|\r\n\t]', '_').Trim()
  if ($t.Length -gt 120) { $t = $t.Substring(0, 120) }
  return "$t [$id].mp4"
}

function Invoke-Job($Job) {
  Write-Log "작업 $($Job.id) 시작: $($Job.url)"
  $jobDir = Join-Path $WorkDir $Job.id
  New-Item -ItemType Directory -Force -Path $jobDir | Out-Null
  try {
    $ytdlp = Find-Tool 'yt-dlp'
    if (-not $ytdlp) { throw 'yt-dlp를 찾지 못했습니다. winget install yt-dlp.yt-dlp 로 설치해 주세요.' }
    $ffmpeg = Find-Tool 'ffmpeg'

    $ytArgs = @(
      $Job.url, '--no-playlist', '--no-progress', '--newline',
      '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b',
      '--merge-output-format', 'mp4',
      '-o', (Join-Path $jobDir '%(id)s.%(ext)s')
    )
    if ($ffmpeg) { $ytArgs += @('--ffmpeg-location', (Split-Path -Parent $ffmpeg)) }
    # YouTube 서명 풀이에는 자바스크립트 실행기가 필요합니다 (Deno가 기본, 없으면 Node)
    if (-not (Find-Tool 'deno')) {
      $node = Find-Tool 'node'
      if ($node) { $ytArgs += @('--js-runtimes', "node:$node") }
    }

    # yt-dlp는 경고를 stderr로 내보내므로, 그 동안만 'Stop'을 풉니다 (PowerShell 5.1)
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $ytdlp @ytArgs 2>&1 } finally { $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) {
      $tail = ($out | Select-Object -Last 5) -join ' / '
      throw "yt-dlp 실패 (코드 $LASTEXITCODE): $tail"
    }
    $file = Get-ChildItem -LiteralPath $jobDir -File | Where-Object { $_.Extension -in '.mp4', '.mkv', '.webm' } |
      Sort-Object Length -Descending | Select-Object -First 1
    if (-not $file) { throw '받은 영상 파일을 찾지 못했습니다.' }
    Write-Log ("  받기 완료: {0:N1} MB" -f ($file.Length / 1MB))

    $name = Get-SafeName $Job.title $Job.url
    if ($file.Extension -ne '.mp4') { $name = [IO.Path]::ChangeExtension($name, $file.Extension.TrimStart('.')) }
    $result = Send-ToDrive $file.FullName $name $Job.id
    Invoke-Api 'jobDone' @{ id = $Job.id; ok = $true; fileId = $result.id; bytes = $file.Length; name = $name } | Out-Null
    Write-Log "작업 $($Job.id) 완료: $name"
  } catch {
    $msg = $_.Exception.Message
    Write-Log "작업 $($Job.id) 실패: $msg"
    try { Invoke-Api 'jobDone' @{ id = $Job.id; ok = $false; message = $msg } | Out-Null } catch { Write-Log "  실패 기록도 못 했습니다: $($_.Exception.Message)" }
  } finally {
    Remove-Item -LiteralPath $jobDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# ───────────────────────── 설정 / 등록 ─────────────────────────

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host '자동 실행을 해제했습니다.'
  return
}

if ($Setup) {
  Write-Host ''
  Write-Host '링크 저장소 PC 도우미 설정' -ForegroundColor Cyan
  Write-Host 'Apps Script 실행 로그에 나온 비밀 키(API_KEY)를 붙여넣고 Enter를 누르세요. (화면에는 보이지 않습니다)'
  $secure = Read-Host -AsSecureString '비밀 키'
  $secure | ConvertFrom-SecureString | Set-Content -Path $KeyPath
  Write-Host '비밀 키를 이 Windows 계정으로 암호화해 저장했습니다.' -ForegroundColor Green

  $script:Config = Get-Config
  $script:ApiKey = Get-ApiKey
  try { Invoke-Api 'stats' | Out-Null; Write-Host '웹 앱 연결 확인: 정상' -ForegroundColor Green }
  catch { Write-Host "웹 앱 연결 실패: $($_.Exception.Message)" -ForegroundColor Red; return }

  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $action  = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $MyInvocation.MyCommand.Path)
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description '링크 저장소: YouTube 대기열을 5분마다 확인해 드라이브에 올립니다.' -Force | Out-Null
  Write-Host "5분마다 자동으로 실행되도록 작업 스케줄러에 '$TaskName'을 등록했습니다." -ForegroundColor Green
  Write-Host '해제하려면: powershell -ExecutionPolicy Bypass -File LinkSaverHelper.ps1 -Unregister'
  return
}

# ───────────────────────── 한 번 실행 ─────────────────────────

$mutex = New-Object Threading.Mutex($false, 'Local\LinkSaverHelper')
if (-not $mutex.WaitOne(0)) { return }   # 이미 다른 실행이 처리 중
try {
  $script:Config = Get-Config
  $script:ApiKey = Get-ApiKey
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

  $jobs = @((Invoke-Api 'jobs').jobs)
  if ($jobs.Count -eq 0 -or -not $jobs[0]) { return }
  foreach ($job in $jobs) { Invoke-Job $job }
} catch {
  Write-Log "실행 오류: $($_.Exception.Message)"
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
