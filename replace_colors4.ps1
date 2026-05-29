# Pass 4: Purple-TINTED surfaces and backgrounds → Rose-tinted equivalents
$files = Get-ChildItem -Path "c:\Users\PC SOFT\Desktop\methna_app\lib" -Recurse -Filter *.dart
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $newContent = $content `
        -replace "0xFFF2EEFA", "0xFFFFF5F7" `
        -replace "0xFFE2DAF1", "0xFFFCE4E8" `
        -replace "0xFFF7F3FF", "0xFFFFF8F9" `
        -replace "0xFFE4DDF3", "0xFFFAE4E8" `
        -replace "0xFFF7E9FF", "0xFFFFF0F3" `
        -replace "0xFFECE7FF", "0xFFFCE4E8" `
        -replace "0xFFF6F0FF", "0xFFFFF5F7" `
        -replace "0xFFEDE7FF", "0xFFFCE4E8" `
        -replace "0xFFF0E7FF", "0xFFFFF0F3" `
        -replace "0xFFF4EEFF", "0xFFFFF5F7" `
        -replace "0xFFFDFBFF", "0xFFFFFAFB" `
        -replace "0xFFDAD1FF", "0xFFFAC5CE" `
        -replace "0xFFF7EEFF", "0xFFFFF0F3" `
        -replace "0xFFF8F4FF", "0xFFFFF8F9" `
        -replace "0xFFE9DDFF", "0xFFFCE4E8" `
        -replace "0xFFD8C6FF", "0xFFF5C5CE" `
        -replace "0xFFDCCFFF", "0xFFFAD0D8" `
        -replace "0xFFF1E8FF", "0xFFFFF0F3" `
        -replace "0xFFF9F3FF", "0xFFFFF8F9" `
        -replace "0xFFF3EEFF", "0xFFFFF5F7" `
        -replace "0xFFF6F1FF", "0xFFFFF5F7" `
        -replace "0xFFE2D5FF", "0xFFFCE4E8" `
        -replace "0xFFF2EBFF", "0xFFFFF0F3" `
        -replace "0xFFF7ECFF", "0xFFFFF0F3" `
        -replace "0xFFEAE4FF", "0xFFFCE4E8" `
        -replace "0xFFF8F2FF", "0xFFFFF8F9" `
        -replace "0xFFEEE9FF", "0xFFFCE4E8" `
        -replace "0xFFF5ECFF", "0xFFFFF0F3" `
        -replace "0xFFEDE1FF", "0xFFFCE4E8" `
        -replace "0xFFF2E8FF", "0xFFFFF0F3" `
        -replace "0xFFEFE3FF", "0xFFFCE4E8" `
        -replace "0xFFF8F1FF", "0xFFFFF5F7" `
        -replace "0xFFE6D8FF", "0xFFFCE4E8" `
        -replace "0xFFEDE6FF", "0xFFFCE4E8" `
        -replace "0xFFF1ECFF", "0xFFFCE4E8" `
        -replace "0xFFE3D7FF", "0xFFFCE4E8" `
        -replace "0xFFE3D8F6", "0xFFFCE4E8" `
        -replace "0xFFF7F2FF", "0xFFFFF5F7" `
        -replace "0xFF2A1D3E", "0xFF2A1D25" `
        -replace "0xFF1B1730", "0xFF1A1520" `
        -replace "0xFF241D3F", "0xFF241D28" `
        -replace "0xFF1C1831", "0xFF1C1520" `
        -replace "0xFF261F42", "0xFF261D28" `
        -replace "0xFF2A2748", "0xFF2A2435" `
        -replace "0xFF2A2847", "0xFF2A2435" `
        -replace "0xFF24213D", "0xFF241D2F" `
        -replace "0xFF2E2B4A", "0xFF2E2840" `
        -replace "0xFF343055", "0xFF3A2D3F" `
        -replace "0xFF151329", "0xFF1A1520" `
        -replace "0xFF141225", "0xFF1A1018" `
        -replace "0xFF0A0918", "0xFF0F0A10" `
        -replace "0xFF1C1A33", "0xFF1C1A28"
    if ($content -ne $newContent) {
        Set-Content $file.FullName -Value $newContent -NoNewline
        Write-Host "Updated $($file.FullName)"
    }
}
