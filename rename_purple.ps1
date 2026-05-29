$files = Get-ChildItem -Path "c:\Users\PC SOFT\Desktop\methna_app\lib" -Recurse -Filter *.dart
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $newContent = $content -replace "\bsignupMockPurple\b", "signupMockPrimary" `
                           -replace "\bsignupMockPurpleEnd\b", "signupMockPrimaryEnd" `
                           -replace "\bexactSignupPurple\b", "exactSignupPrimary" `
                           -replace "\bexactSignupPurpleEnd\b", "exactSignupPrimaryEnd" `
                           -replace "\b_PurpleButton\b", "_BrandButton" `
                           -replace "\bPurpleButton\b", "BrandButton" `
                           -replace "purple:", "primaryBrand:" `
                           -replace "purpleLight:", "primaryLightBrand:" `
                           -replace "\bpurple\b", "primaryBrand" `
                           -replace "\bpurpleLight\b", "primaryLightBrand" `
                           -replace "\b_purple\b", "_primaryBrand" `
                           -replace "\b_purpleLight\b", "_primaryLightBrand" `
                           -replace "Color\(0xFFE85D75\); // Purple", "Color(0xFFE85D75); // Rose" `
                           -replace "soft purple", "soft rose" `
                           -replace "Purple \`"Our Packages\`"", "Rose \`"Our Packages\`""
    if ($content -ne $newContent) {
        Set-Content $file.FullName -Value $newContent -NoNewline
        Write-Host "Updated $($file.FullName)"
    }
}
