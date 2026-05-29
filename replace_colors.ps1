$files = Get-ChildItem -Path "c:\Users\PC SOFT\Desktop\methna_app\lib" -Recurse -Filter *.dart
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $newContent = $content -replace "(?i)0xFF6C3BFF", "0xFFE85D75" `
                           -replace "(?i)0xFF9E5BFF", "0xFFF07A90" `
                           -replace "(?i)0xFF4C20CF", "0xFFB93F5A" `
                           -replace "(?i)0xFF8F18FF", "0xFFE85D75" `
                           -replace "(?i)0xFFA020F9", "0xFFE85D75" `
                           -replace "(?i)0xFF7D18FF", "0xFFD14F6A" `
                           -replace "(?i)0xFF8D19FF", "0xFFE85D75" `
                           -replace "(?i)0xFF8E2CFF", "0xFFE85D75" `
                           -replace "(?i)0xFF9627FF", "0xFFE85D75" `
                           -replace "(?i)0xFF7B1FFF", "0xFFD14F6A" `
                           -replace "(?i)0xFF7F38FF", "0xFFE85D75" `
                           -replace "(?i)0xFFB44CFF", "0xFFF07A90" `
                           -replace "(?i)0xFF4B24CC", "0xFFB93F5A" `
                           -replace "(?i)0xFFB27BFF", "0xFFF07A90" `
                           -replace "(?i)0xFF7C1EFF", "0xFFD14F6A" `
                           -replace "(?i)0xFFBDA7FF", "0xFFFAC5CE" `
                           -replace "(?i)0x338E2CFF", "0x33E85D75" `
                           -replace "(?i)0x22A020F9", "0x22E85D75" `
                           -replace "(?i)0x806C3BFF", "0x80E85D75" `
                           -replace "(?i)0x1A6C3BFF", "0x1AE85D75" `
                           -replace "(?i)0x709E5BFF", "0x70F07A90" `
                           -replace "(?i)0x149E5BFF", "0x14F07A90" `
                           -replace "(?i)0x146C3BFF", "0x14E85D75" `
                           -replace "(?i)0x706C3BFF", "0x70E85D75" `
                           -replace "(?i)0xFFB454FF", "0xFFF07A90" `
                           -replace "(?i)0xFFAB47BC", "0xFFE85D75"
    if ($content -ne $newContent) {
        Set-Content $file.FullName -Value $newContent -NoNewline
        Write-Host "Updated $($file.FullName)"
    }
}
