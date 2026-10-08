$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $project ('.local\profile-tests\' + [Guid]::NewGuid().ToString('N'))
$inputDir = Join-Path $testRoot 'input'
$outputDir = Join-Path $testRoot 'output'
[void][IO.Directory]::CreateDirectory($inputDir)
$utf8 = New-Object Text.UTF8Encoding($true)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-Check([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Write-Workbook([string]$Path, [string]$SheetXml, [string]$Target = 'worksheets/custom.xml') {
  $archive = [IO.Compression.ZipFile]::Open($Path, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $entries = @{
      'xl/workbook.xml' = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Test &amp; arkusz" sheetId="1" r:id="rId1"/></sheets></workbook>'
      'xl/_rels/workbook.xml.rels' = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="' + $Target + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>')
      'xl/sharedStrings.xml' = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Nazwa</t></si><si><t>Kod</t></si><si><t>Ilosc</t></si><si><t>Testowe urzadzenie</t></si><si><t>0007</t></si></sst>'
      'xl/worksheets/custom.xml' = $SheetXml
    }
    foreach ($name in $entries.Keys) {
      $entry = $archive.CreateEntry($name)
      $stream = $entry.Open()
      $writer = New-Object IO.StreamWriter($stream, (New-Object Text.UTF8Encoding($false)))
      try { $writer.Write($entries[$name]) } finally { $writer.Dispose(); $stream.Dispose() }
    }
  } finally { $archive.Dispose() }
}

$csv = "Nazwa;Kod;Uwagi`r`nTestowe urzadzenie;0007;`"Test; uwaga`"`r`nTestowe urzadzenie;0007;`"Dwie`r`nlinie`"`r`nInne;;`r`n"
[IO.File]::WriteAllText((Join-Path $inputDir 'synthetic.csv'), $csv, $utf8)
[IO.File]::WriteAllText((Join-Path $inputDir 'malformed.csv'), "Nazwa;Kod`n`"SYNTHETIC_PRIVATE_MARKER", $utf8)
[IO.File]::WriteAllText((Join-Path $inputDir 'html-header.csv'), "`"<script>alert(1)</script>`";Kod`nTest;0001", $utf8)
$polishHeader = 'Ilo' + [char]0x015B + [char]0x0107
$encodedCsv = $polishHeader + ";Kod`r`n2;0001`r`n"
[IO.File]::WriteAllText((Join-Path $inputDir 'windows1250.csv'), $encodedCsv, [Text.Encoding]::GetEncoding(1250))
[IO.File]::WriteAllText((Join-Path $inputDir 'utf16.csv'), $encodedCsv, [Text.Encoding]::Unicode)
[IO.File]::WriteAllText((Join-Path $inputDir 'comma.csv'), "`"Opis, nazwa`",Kod`nTest,0001", $utf8)
$sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><r><t>Ko</t></r><r><t>d</t></r></is></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><f>1+1</f><v>2</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Inne urzadzenie</t></is></c><c r="B3" t="s"><v>4</v></c></row></sheetData></worksheet>'
Write-Workbook (Join-Path $inputDir 'synthetic.xlsx') $sheet
Write-Workbook (Join-Path $inputDir 'external-sheet.xlsx') $sheet 'https://example.invalid/private.xml'
Write-Workbook (Join-Path $inputDir 'dtd.xlsx') ('<!DOCTYPE worksheet [<!ENTITY secret SYSTEM "file:///C:/private.invalid">]>' + $sheet)

$log = @(& (Join-Path $project 'Inspect-Inventory.ps1') -InputDirectory $inputDir -OutputDirectory $outputDir)
Assert-Check ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) 'Local profiler did not complete.'
$json = [IO.File]::ReadAllText((Join-Path $outputDir 'summary.json'), [Text.Encoding]::UTF8)
$report = $json | ConvertFrom-Json
$csvReport = @($report.Files | Where-Object { $_.File -eq 'synthetic.csv' })[0]
Assert-Check ($csvReport.Status -eq 'OK') 'Quoted CSV parsing failed.'
$csvSheet = @($csvReport.Sheets)[0]
Assert-Check ($csvSheet.RowCount -eq 3) 'Multiline CSV row count failed.'
$code = @($csvSheet.Columns | Where-Object { $_.Header -eq 'Kod' })[0]
Assert-Check ($code.Empty -eq 1 -and $code.Unique -eq 1 -and $code.Repeated -eq 1) 'CSV identifier profiling failed.'
$xlsxReport = @($report.Files | Where-Object { $_.File -eq 'synthetic.xlsx' })[0]
Assert-Check ($xlsxReport.Status -eq 'OK') 'XLSX parsing failed.'
$xlsxSheet = @($xlsxReport.Sheets)[0]
Assert-Check ($xlsxSheet.RowCount -eq 2 -and $xlsxSheet.FormulaCells -eq 1 -and $xlsxSheet.NumericCells -eq 1) 'XLSX cell profiling failed.'
$xlsxCode = @($xlsxSheet.Columns | Where-Object { $_.Header -eq 'Kod' })[0]
Assert-Check ($xlsxCode.Unique -eq 1 -and $xlsxCode.Repeated -eq 1) 'XLSX shared strings or leading zero preservation failed.'
$quantity = @($xlsxSheet.Columns | Where-Object { $_.Header -eq 'Ilosc' })[0]
Assert-Check ($quantity.Empty -eq 1) 'Sparse XLSX columns were shifted.'
foreach ($name in @('malformed.csv','external-sheet.xlsx','dtd.xlsx')) {
  Assert-Check (@($report.Files | Where-Object { $_.File -eq $name })[0].Status -eq 'ERROR') 'Malformed or external input was not refused.'
}
$html = [IO.File]::ReadAllText((Join-Path $outputDir 'summary.html'), [Text.Encoding]::UTF8)
Assert-Check ($html.Contains('&lt;script&gt;alert(1)&lt;/script&gt;')) 'Report header escaping failed.'
Assert-Check (!$html.Contains('<script>alert(1)</script>')) 'Raw HTML leaked into report.'
Assert-Check (!$json.Contains('SYNTHETIC_PRIVATE_MARKER') -and !$html.Contains('SYNTHETIC_PRIVATE_MARKER') -and !(($log -join '').Contains('SYNTHETIC_PRIVATE_MARKER'))) 'An input value leaked into an output.'
Assert-Check (!$json.Contains('Testowe urzadzenie') -and !$html.Contains('Testowe urzadzenie')) 'Row values appeared in profiling reports.'
Assert-Check ($html.Contains("default-src 'none'")) 'Offline report policy is missing.'
foreach ($name in @('windows1250.csv','utf16.csv')) {
  $encodedFile = @($report.Files | Where-Object { $_.File -eq $name })[0]
  Assert-Check ($encodedFile.Status -eq 'OK' -and @($encodedFile.Sheets)[0].Columns[0].Header -eq $polishHeader) 'Polish CSV encoding detection failed.'
}
$commaFile = @($report.Files | Where-Object { $_.File -eq 'comma.csv' })[0]
Assert-Check ($commaFile.Status -eq 'OK' -and @($commaFile.Sheets)[0].Columns[0].Header -eq 'Opis, nazwa') 'Comma delimiter with quoted header failed.'
$secondInput = Join-Path $testRoot 'header-input'
$secondOutput = Join-Path $testRoot 'header-output'
[void][IO.Directory]::CreateDirectory($secondInput)
[IO.File]::WriteAllText((Join-Path $secondInput 'header.csv'), "Opis raportu`r`nNazwa;Kod`r`nTest;0001", $utf8)
$null = & (Join-Path $project 'Inspect-Inventory.ps1') -InputDirectory $secondInput -OutputDirectory $secondOutput -HeaderRow 2
$secondReport = [IO.File]::ReadAllText((Join-Path $secondOutput 'summary.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
Assert-Check ($secondReport.Files[0].Status -eq 'OK' -and $secondReport.Files[0].Sheets[0].RowCount -eq 1 -and $secondReport.Files[0].Sheets[0].Columns.Count -eq 2) 'Alternate header row failed.'
Write-Output 'PASS: CSV quoting/multiline/encodings, XLSX strings/sparse cells, formula warnings, header selection, external XML rejection, escaped headers, and no raw row output.'
