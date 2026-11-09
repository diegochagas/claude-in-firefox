# scripts/setup.ps1: Windows counterpart of scripts/setup. Idempotent.
#   1. npm ci + build
#   2. write the native-messaging host manifest and register it under
#      HKCU\Software\Mozilla\NativeMessagingHosts (read by Firefox and Firefox-based browsers)
#   3. register the MCP server in Claude Code (user scope) unless -NoMcp
# -Uninstall removes the registry key and the MCP registration.
[CmdletBinding()]
param([switch]$NoMcp, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$HostName = 'claude_in_firefox'
$ExtensionId = 'claude-in-firefox@diegochagas.dev'
$RegistryKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\$HostName"
$ManifestPath = Join-Path $RepoDir "dist\$HostName.json"

function Install-Dependencies {
    Push-Location $RepoDir
    try {
        if (Test-Path node_modules) { Write-Host 'node_modules present, skipping npm ci' } else { npm ci; if ($LASTEXITCODE) { throw 'npm ci failed' } }
        npm run build --silent; if ($LASTEXITCODE) { throw 'build failed' }
    } finally { Pop-Location }
}

function Register-NativeHost {
    $manifest = [ordered]@{
        name               = $HostName
        description        = 'Claude in Firefox native messaging host'
        path               = (Join-Path $RepoDir 'dist\native-host.bat')
        type               = 'stdio'
        allowed_extensions = @($ExtensionId)
    }
    # WriteAllText writes UTF-8 without a BOM; Set-Content -Encoding utf8 adds one on PowerShell 5.1.
    [IO.File]::WriteAllText($ManifestPath, ($manifest | ConvertTo-Json))
    New-Item -Path $RegistryKey -Force | Out-Null
    Set-Item -Path $RegistryKey -Value $ManifestPath
    Write-Host "native host manifest: $ManifestPath (registered at $RegistryKey)"
}

function Register-McpServer {
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
        Write-Host "claude CLI not found; register manually: claude mcp add --scope user claude-in-firefox -- node `"$RepoDir\dist\mcp-server.js`""
        return
    }
    # Windows PowerShell 5.1 turns native stderr into a terminating error under 'Stop';
    # "no such server" on stderr is an expected answer here.
    $ErrorActionPreference = 'Continue'
    claude mcp get claude-in-firefox *> $null
    if ($LASTEXITCODE -eq 0) { claude mcp remove --scope user claude-in-firefox *> $null }
    # Absolute node path: Claude Code may start with a PATH from before Node was installed.
    $node = (Get-Command node).Source
    claude mcp add --scope user claude-in-firefox -- $node (Join-Path $RepoDir 'dist\mcp-server.js')
    if ($LASTEXITCODE) { throw "claude mcp add failed (exit $LASTEXITCODE)" }
    Write-Host 'MCP server registered in Claude Code (user scope) as claude-in-firefox'
}

function Unregister-All {
    if (Test-Path $RegistryKey) { Remove-Item -Path $RegistryKey -Force; Write-Host "removed $RegistryKey" }
    $ErrorActionPreference = 'Continue'
    if (Get-Command claude -ErrorAction SilentlyContinue) { claude mcp remove --scope user claude-in-firefox *> $null }
    Write-Host 'Uninstalled. Remove the extension from your browser in about:addons.'
}

if ($Uninstall) { Unregister-All; return }
Install-Dependencies
Register-NativeHost
if (-not $NoMcp) { Register-McpServer }
Write-Host @"

Next:
  - Install the extension: the signed .xpi from
    https://github.com/diegochagas/claude-in-firefox/releases (drag it into the browser window),
    or about:debugging#/runtime/this-firefox -> Load Temporary Add-on -> $RepoDir\dist\extension\manifest.json
  - The toolbar badge shows "on" when the native host is connected.
"@
