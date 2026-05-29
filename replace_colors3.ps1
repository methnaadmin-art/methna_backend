$files = Get-ChildItem -Path "c:\Users\PC SOFT\Desktop\methna_app\lib" -Recurse -Filter *.dart
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $newContent = $content -replace "0xFFB35DFF", "0xFFF07A90" `
                           -replace "0xFFB576FF", "0xFFF07A90" `
                           -replace "0xFFB18EFF", "0xFFF5A0B0" `
                           -replace "0xFF8B5CFF", "0xFFE85D75"
    if ($content -ne $newContent) {
        Set-Content $file.FullName -Value $newContent -NoNewline
        Write-Host "Updated $($file.FullName)"
    }
}
