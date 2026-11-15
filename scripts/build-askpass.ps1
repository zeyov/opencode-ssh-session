# Builds the tiny helper OpenSSH calls to collect the password.
#
# The plugin always asks for the password in the OpenCode UI and passes it to this
# helper through OC_SSH_PASSWORD, so the helper only echoes that value: no window, no
# user interaction. Rebuild it only if scripts/askpass.exe is missing.
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'askpass.exe'
$cs = Join-Path $env:TEMP 'opencode-askpass.cs'

$source = @'
using System;

public static class AskPass
{
    public static void Main(string[] args)
    {
        string password = Environment.GetEnvironmentVariable("OC_SSH_PASSWORD") ?? "";
        Console.Out.Write(password);
        Console.Out.Flush();
    }
}
'@

Set-Content -Path $cs -Value $source -Encoding UTF8

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (Test-Path $csc) {
    & $csc /nologo /target:exe /out:$out $cs | Out-Null
} else {
    Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $out -OutputType ConsoleApplication
}

Remove-Item $cs -Force
if (-not (Test-Path $out)) { throw "askpass.exe was not produced" }
Get-Item $out | Select-Object FullName, Length
