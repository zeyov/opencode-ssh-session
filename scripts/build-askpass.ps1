$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'askpass.exe'
$cs = Join-Path $env:TEMP 'opencode-askpass.cs'

$source = @'
using System;
using System.Drawing;
using System.Windows.Forms;

public static class AskPass
{
    [STAThread]
    public static void Main(string[] args)
    {
        // The plugin puts the password here when the OpenCode dialog already asked for it.
        string fromEnv = Environment.GetEnvironmentVariable("OC_SSH_PASSWORD");
        if (!string.IsNullOrEmpty(fromEnv))
        {
            Console.Out.Write(fromEnv);
            Console.Out.Flush();
            Environment.Exit(0);
        }

        string prompt = args.Length > 0 ? args[0] : "SSH password:";
        string value = null;

        using (var form = new Form())
        {
            form.Text = "OpenCode SSH";
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MinimizeBox = false;
            form.MaximizeBox = false;
            form.TopMost = true;
            form.Width = 420;
            form.Height = 170;

            var label = new Label { Text = prompt, Left = 16, Top = 16, Width = 380, Height = 40 };
            var input = new TextBox { Left = 16, Top = 58, Width = 372, UseSystemPasswordChar = true };
            var ok = new Button { Text = "OK", Left = 300, Top = 92, Width = 88, DialogResult = DialogResult.OK };
            var cancel = new Button { Text = "Cancel", Left = 204, Top = 92, Width = 88, DialogResult = DialogResult.Cancel };

            form.Controls.Add(label);
            form.Controls.Add(input);
            form.Controls.Add(ok);
            form.Controls.Add(cancel);
            form.AcceptButton = ok;
            form.CancelButton = cancel;
            form.Shown += (s, e) => input.Focus();

            if (form.ShowDialog() != DialogResult.OK) Environment.Exit(1);
            value = input.Text;
        }

        Console.Out.Write(value);
        Console.Out.Flush();
        Environment.Exit(0);
    }
}
'@

Set-Content -Path $cs -Value $source -Encoding UTF8

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (Test-Path $csc) {
    & $csc /nologo /target:winexe /out:$out /r:System.Windows.Forms.dll /r:System.Drawing.dll $cs | Out-Null
} else {
    Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $out -OutputType ConsoleApplication `
        -ReferencedAssemblies System.Windows.Forms, System.Drawing
}

Remove-Item $cs -Force
if (-not (Test-Path $out)) { throw "askpass.exe was not produced" }
Get-Item $out | Select-Object FullName, Length
