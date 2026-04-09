# Open Housing.com deeplink on Android emulator
# Prerequisites: Android emulator running, ADB in PATH

$DEEPLINK = "https://housing.com/in/buy/mumbai/andheri_west"
$PACKAGE = "com.locon.housing"

Write-Host "Checking for connected devices..." -ForegroundColor Cyan
$devices = adb devices
if ($devices -notmatch "device$") {
    Write-Host "No emulator/device found. Start your Android emulator first." -ForegroundColor Red
    exit 1
}

Write-Host "Opening deeplink in Housing app: $DEEPLINK" -ForegroundColor Green
adb shell am start -a android.intent.action.VIEW -d $DEEPLINK -p $PACKAGE

if ($LASTEXITCODE -eq 0) {
    Write-Host "Deeplink launched. Wait for search results to load." -ForegroundColor Green
} else {
    Write-Host "Fallback: opening URL (may open in browser or app chooser)..." -ForegroundColor Yellow
    adb shell am start -a android.intent.action.VIEW -d $DEEPLINK
}
