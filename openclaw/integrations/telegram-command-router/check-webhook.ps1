# Read .env file to load variables locally if running on a developer machine
if (Test-Path ".env") {
    Get-Content .env | Foreach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains('=')) {
            $name, $value = $line.split('=', 2)
            if ($name -and $value) {
                [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim())
            }
        }
    }
}

$botToken = [System.Environment]::GetEnvironmentVariable("TELEGRAM_BOT_TOKEN")

if (-not $botToken) {
    Write-Host "Error: TELEGRAM_BOT_TOKEN environment variable is not set." -ForegroundColor Red
    exit 1
}

Write-Host "Checking Telegram webhook registration info..."
$uri = "https://api.telegram.org/bot$botToken/getWebhookInfo"
try {
    $response = Invoke-RestMethod -Uri $uri -Method Get
    if ($response.ok) {
        $result = $response.result
        Write-Host "--------------------------------------" -ForegroundColor Cyan
        Write-Host "Webhook URL:          $($result.url)"
        Write-Host "Pending Update Count: $($result.pending_update_count)"
        Write-Host "Max Connections:      $($result.max_connections)"
        
        if ($result.last_error_date) {
            $errDate = [DateTimeOffset]::FromUnixTimeSeconds($result.last_error_date).DateTime
            Write-Host "Last Error Date:      $errDate" -ForegroundColor Yellow
            Write-Host "Last Error Message:   $($result.last_error_message)" -ForegroundColor Yellow
        } else {
            Write-Host "Last Error:           None"
        }
        
        $matchesRoute = $($result.url) -like "*/webhook/telegram"
        Write-Host "Matches /webhook/telegram route: $matchesRoute"
        Write-Host "--------------------------------------" -ForegroundColor Cyan
    } else {
        Write-Host "Error: Failed to fetch webhook info from Telegram API." -ForegroundColor Red
    }
} catch {
    Write-Host "Request failed: $_" -ForegroundColor Red
}
