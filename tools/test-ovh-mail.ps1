param(
  [string]$To = "savin.jerome@gmail.com",
  [string]$From = "organisateurs@party-retro-chill-hub.fr",
  [string]$SmtpHost = "ssl0.ovh.net",
  [int]$Port = 587,
  [string]$Subject = "Test email Party Retro Chill Hub"
)

$ErrorActionPreference = "Stop"

$password = Read-Host "Mot de passe SMTP OVH pour $From" -AsSecureString
$credential = New-Object System.Net.NetworkCredential($From, $password)

$message = New-Object System.Net.Mail.MailMessage
$message.From = New-Object System.Net.Mail.MailAddress($From, "Organisateurs Party Retro Chill Hub")
$message.To.Add($To)
$message.Subject = $Subject
$message.SubjectEncoding = [System.Text.Encoding]::UTF8
$message.BodyEncoding = [System.Text.Encoding]::UTF8
$message.IsBodyHtml = $false
$message.Body = @"
Bonjour,

Ceci est un email de test envoye depuis la boite OVH $From.

Si vous recevez ce message, la configuration SMTP est operationnelle.
"@

$client = New-Object System.Net.Mail.SmtpClient($SmtpHost, $Port)
$client.EnableSsl = $true
$client.Credentials = $credential
try {
  $client.Send($message)
  Write-Host "Email envoye a $To depuis $From via ${SmtpHost}:$Port"
} catch {
  Write-Host "Echec de l'envoi SMTP." -ForegroundColor Red
  Write-Host "Message: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.Exception.StatusCode) {
    Write-Host "Status SMTP: $($_.Exception.StatusCode)" -ForegroundColor Red
  }
  if ($_.Exception.InnerException) {
    Write-Host "Detail: $($_.Exception.InnerException.Message)" -ForegroundColor Red
  }
  throw
}
