$files = Get-ChildItem -Path "c:\Users\PC SOFT\Desktop\methna_app\lib" -Recurse -Filter *.dart
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $newContent = $content -replace "0xFF8F23FF", "0xFFE85D75" `
                           -replace "0xFFB54BFF", "0xFFF07A90" `
                           -replace "0xFFA134FF", "0xFFE85D75" `
                           -replace "0xFF932DFF", "0xFFD14F6A" `
                           -replace "0xFF941AFF", "0xFFE85D75" `
                           -replace "0xFF9A1FFF", "0xFFE85D75" `
                           -replace "0xFF8A14FF", "0xFFD14F6A" `
                           -replace "0xFF8C18FF", "0xFFE85D75" `
                           -replace "0xFFA741FF", "0xFFF07A90" `
                           -replace "0xFF9423FF", "0xFFE85D75" `
                           -replace "0xFFAA47FF", "0xFFF07A90" `
                           -replace "0xFF8D22FF", "0xFFE85D75" `
                           -replace "0xFFA745FF", "0xFFF07A90" `
                           -replace "0xFF971DFF", "0xFFE85D75" `
                           -replace "0xFF8A22FF", "0xFFE85D75" `
                           -replace "0xFF9123FF", "0xFFE85D75" `
                           -replace "0xFF9022FF", "0xFFE85D75" `
                           -replace "0xFFE3D8F6", "0xFFFCE4E8"
    if ($content -ne $newContent) {
        Set-Content $file.FullName -Value $newContent -NoNewline
        Write-Host "Updated $($file.FullName)"
    }
}
