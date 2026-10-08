param(
  [string]$InputDirectory = (Join-Path $env:LOCALAPPDATA 'IT-Hardware\imports'),
  [string]$OutputDirectory = (Join-Path $env:LOCALAPPDATA 'IT-Hardware\import-reports'),
  [ValidateRange(1,1000)][int]$HeaderRow = 1,
  [ValidateSet('Auto','UTF8','Windows1250','Windows1252')][string]$CsvEncoding = 'Auto'
)

# Local, read-only profiling. No API, database, network, or raw-row logging.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName Microsoft.VisualBasic
$maxBytes = 50MB
$maxExpandedBytes = 100MB
$maxRows = 100000
$maxColumns = 256

function Read-SafeXml([System.IO.Compression.ZipArchive]$Archive, [string]$EntryName) {
  $entry = $Archive.GetEntry($EntryName)
  if (!$entry -or $entry.Length -gt $maxExpandedBytes) { throw 'Unsupported workbook structure.' }
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $settings.MaxCharactersInDocument = $maxExpandedBytes
  $stream = $entry.Open()
  $reader = $null
  try {
    $reader = [System.Xml.XmlReader]::Create($stream, $settings)
    $document = New-Object System.Xml.XmlDocument
    $document.XmlResolver = $null
    $document.Load($reader)
    return ,$document
  } finally {
    if ($reader) { $reader.Dispose() }
    $stream.Dispose()
  }
}

function Get-ColumnIndex([string]$Reference) {
  if ($Reference -notmatch '^([A-Z]+)[1-9][0-9]*$') { throw 'Invalid cell reference.' }
  $index = 0
  foreach ($letter in $Matches[1].ToCharArray()) {
    $index = $index * 26 + ([int]$letter - [int][char]'A' + 1)
    if ($index -gt $maxColumns) { throw 'Too many columns.' }
  }
  return $index - 1
}

function Read-Workbook([string]$Path) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $totalExpanded = 0L
    foreach ($entry in $archive.Entries) {
      $totalExpanded += $entry.Length
      if ($totalExpanded -gt $maxExpandedBytes) { throw 'Workbook is too large.' }
    }
    $workbook = Read-SafeXml $archive 'xl/workbook.xml'
    $relations = Read-SafeXml $archive 'xl/_rels/workbook.xml.rels'
    $strings = New-Object 'System.Collections.Generic.List[string]'
    if ($archive.GetEntry('xl/sharedStrings.xml')) {
      $shared = Read-SafeXml $archive 'xl/sharedStrings.xml'
      foreach ($item in $shared.SelectNodes('//*[local-name()="si"]')) {
        $parts = @($item.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText })
        $strings.Add(($parts -join ''))
      }
    }
    $results = New-Object 'System.Collections.Generic.List[object]'
    foreach ($sheet in $workbook.SelectNodes('//*[local-name()="sheets"]/*[local-name()="sheet"]')) {
      $relationId = @($sheet.Attributes | Where-Object { $_.LocalName -eq 'id' })[0].Value
      $relation = @($relations.DocumentElement.ChildNodes | Where-Object { $_.GetAttribute('Id') -eq $relationId })
      if ($relation.Count -ne 1 -or $relation[0].GetAttribute('TargetMode') -eq 'External') { throw 'Unsupported sheet relationship.' }
      $baseUri = [Uri]'https://local.invalid/xl/workbook.xml'
      $targetUri = New-Object Uri($baseUri, $relation[0].GetAttribute('Target'))
      if ($targetUri.Host -ne 'local.invalid' -or $targetUri.AbsolutePath -notmatch '^/xl/worksheets/[^/]+\.xml$') { throw 'Unsupported sheet path.' }
      $document = Read-SafeXml $archive $targetUri.AbsolutePath.TrimStart('/')
      $rows = New-Object 'System.Collections.Generic.List[object]'
      $headers = $null
      $formulaCells = 0
      $numericCells = 0
      foreach ($row in $document.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]')) {
        $rowNumber = [int]$row.GetAttribute('r')
        if ($rowNumber -lt $HeaderRow) { continue }
        $cells = @{}
        $width = 0
        foreach ($cell in $row.SelectNodes('./*[local-name()="c"]')) {
          $index = Get-ColumnIndex $cell.GetAttribute('r')
          $width = [Math]::Max($width, $index + 1)
          $valueNode = $cell.SelectSingleNode('./*[local-name()="v"]')
          $value = if ($valueNode) { $valueNode.InnerText } else { '' }
          $cellType = $cell.GetAttribute('t')
          if ($cellType -eq 's') {
            $stringIndex = 0
            if (![int]::TryParse($value, [ref]$stringIndex) -or $stringIndex -lt 0 -or $stringIndex -ge $strings.Count) { throw 'Invalid shared string.' }
            $value = $strings[$stringIndex]
          } elseif ($cellType -eq 'inlineStr') {
            $value = (@($cell.SelectNodes('./*[local-name()="is"]//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '')
          } elseif ($cellType -eq '' -and $value -ne '' -and $rowNumber -gt $HeaderRow) {
            $numericCells++
          }
          if ($cell.SelectSingleNode('./*[local-name()="f"]')) { $formulaCells++ }
          $cells[$index] = $value
        }
        if ($width -eq 0) { continue }
        $values = New-Object string[] $width
        for ($i = 0; $i -lt $width; $i++) { $values[$i] = if ($cells.ContainsKey($i)) { [string]$cells[$i] } else { '' } }
        if ($rowNumber -eq $HeaderRow) { $headers = $values }
        else {
          if ($rows.Count -ge $maxRows) { throw 'Too many rows.' }
          $rows.Add([pscustomobject]@{ Number=$rowNumber; Values=$values })
        }
      }
      if (!$headers) { throw 'Header row not found.' }
      $results.Add([pscustomobject]@{ Name=$sheet.GetAttribute('name'); Headers=$headers; Rows=$rows.ToArray(); FormulaCells=$formulaCells; NumericCells=$numericCells })
    }
    return ,$results.ToArray()
  } finally { $archive.Dispose() }
}

function Read-CsvContent([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($CsvEncoding -eq 'Windows1250') { return [Text.Encoding]::GetEncoding(1250).GetString($bytes) }
  if ($CsvEncoding -eq 'Windows1252') { return [Text.Encoding]::GetEncoding(1252).GetString($bytes) }
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) { return [Text.Encoding]::Unicode.GetString($bytes).TrimStart([char]0xFEFF) }
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) { return [Text.Encoding]::BigEndianUnicode.GetString($bytes).TrimStart([char]0xFEFF) }
  $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
  try { return $utf8.GetString($bytes).TrimStart([char]0xFEFF) }
  catch {
    if ($CsvEncoding -eq 'UTF8') { throw 'Invalid UTF8.' }
    return [Text.Encoding]::GetEncoding(1250).GetString($bytes)
  }
}

function New-CsvParser([string]$Content, [string]$Delimiter) {
  $reader = New-Object System.IO.StringReader($Content)
  $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($reader)
  $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
  $parser.SetDelimiters(@($Delimiter))
  $parser.HasFieldsEnclosedInQuotes = $true
  $parser.TrimWhiteSpace = $false
  return $parser
}

function Read-LocalCsv([string]$Path) {
  $content = Read-CsvContent $Path
  $delimiter = $null
  if ($content -match '^sep=([;,\t])\r?\n') {
    $delimiter = $Matches[1]
    $content = $content.Substring($Matches[0].Length)
  } else {
    $best = -1
    foreach ($candidate in @(';', ',', "`t")) {
      $candidateParser = New-CsvParser $content $candidate
      try {
        $fields = $null
        for ($j = 0; $j -lt $HeaderRow -and !$candidateParser.EndOfData; $j++) { $fields = $candidateParser.ReadFields() }
        if ($fields -and $fields.Count -gt $best) { $best = $fields.Count; $delimiter = $candidate }
      } catch { } finally { $candidateParser.Close() }
    }
  }
  if (!$delimiter) { throw 'Delimiter not found.' }
  $parser = New-CsvParser $content $delimiter
  try {
    $headers = $null
    for ($j = 0; $j -lt $HeaderRow -and !$parser.EndOfData; $j++) { $headers = $parser.ReadFields() }
    if (!$headers -or $headers.Count -gt $maxColumns) { throw 'Invalid headers.' }
    $rows = New-Object 'System.Collections.Generic.List[object]'
    $record = $HeaderRow
    while (!$parser.EndOfData) {
      $record++
      $fields = $parser.ReadFields()
      if ($fields.Count -gt $maxColumns -or $rows.Count -ge $maxRows) { throw 'File is too large.' }
      $rows.Add([pscustomobject]@{ Number=$record; Values=$fields })
    }
    return ,@([pscustomobject]@{ Name='CSV'; Headers=$headers; Rows=$rows.ToArray(); FormulaCells=0; NumericCells=0 })
  } finally { $parser.Close() }
}

function Get-Profile($Sheet) {
  $columns = New-Object 'System.Collections.Generic.List[object]'
  $badWidth = 0
  foreach ($row in $Sheet.Rows) { if ($row.Values.Count -gt $Sheet.Headers.Count) { $badWidth++ } }
  for ($i = 0; $i -lt $Sheet.Headers.Count; $i++) {
    $name = [string]$Sheet.Headers[$i]
    $empty = 0
    $counts = New-Object 'System.Collections.Generic.Dictionary[string,int]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($row in $Sheet.Rows) {
      $value = if ($i -lt $row.Values.Count) { ([string]$row.Values[$i]).Trim() } else { '' }
      if ($value -eq '') { $empty++; continue }
      if ($counts.ContainsKey($value)) { $counts[$value]++ } else { $counts.Add($value, 1) }
    }
    $repeatRows = 0
    foreach ($count in $counts.Values) { if ($count -gt 1) { $repeatRows += $count - 1 } }
    $columns.Add([pscustomobject]@{ Position=$i+1; Header=$name; Empty=$empty; Unique=$counts.Count; Repeated=$repeatRows })
  }
  return [pscustomobject]@{ Sheet=$Sheet.Name; RowCount=$Sheet.Rows.Count; ExtraColumnRows=$badWidth; FormulaCells=$Sheet.FormulaCells; NumericCells=$Sheet.NumericCells; Columns=$columns.ToArray() }
}

function Escape-Html([object]$Value) { return [System.Net.WebUtility]::HtmlEncode([string]$Value) }

try {
  [void][System.IO.Directory]::CreateDirectory($InputDirectory)
  [void][System.IO.Directory]::CreateDirectory($OutputDirectory)
  $results = New-Object 'System.Collections.Generic.List[object]'
  $files = @(Get-ChildItem -LiteralPath $InputDirectory -File | Where-Object { $_.Extension.ToLowerInvariant() -in '.csv','.xlsx' } | Sort-Object Name)
  foreach ($file in $files) {
    if ($file.Length -gt $maxBytes) {
      $results.Add([pscustomobject]@{ File=$file.Name; Status='LIMIT'; Sheets=@() })
      continue
    }
    try {
      $sheets = if ($file.Extension -ieq '.xlsx') { Read-Workbook $file.FullName } else { Read-LocalCsv $file.FullName }
      $profiles = @($sheets | ForEach-Object { Get-Profile $_ })
      $results.Add([pscustomobject]@{ File=$file.Name; Status='OK'; Sheets=$profiles })
    } catch {
      # Parser errors can contain original lines. Never print their message.
      $results.Add([pscustomobject]@{ File=$file.Name; Status='ERROR'; Sheets=@() })
    }
  }
  $report = [pscustomobject]@{ Version=1; CreatedAt=(Get-Date).ToString('s'); HeaderRow=$HeaderRow; Files=$results.ToArray() }
  $encoding = New-Object System.Text.UTF8Encoding($true)
  [IO.File]::WriteAllText((Join-Path $OutputDirectory 'summary.json'), ($report | ConvertTo-Json -Depth 8), $encoding)
  $html = New-Object System.Text.StringBuilder
  [void]$html.Append('<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src ''none''; style-src ''unsafe-inline''; base-uri ''none''; form-action ''none''"><title>Profil lokalnej ewidencji</title><style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;background:#f4f6f7;color:#17303c}section{background:#fff;padding:20px;margin:20px 0;border:1px solid #d9e2e6;border-radius:8px}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #e3e9ec;overflow-wrap:anywhere}th{background:#eef4f4}.note{color:#465d68}h1,h2,h3{overflow-wrap:anywhere}a{color:inherit}</style></head><body><h1>Profil lokalnej ewidencji</h1><p class="note">Raport wykonano na tym komputerze. Brak połączeń sieciowych i zapisu do bazy aplikacji. Raport zawiera nazwy plików, arkuszy i kolumn oraz statystyki; nie zawiera wartości z wierszy danych.</p>')
  if ($results.Count -eq 0) { [void]$html.Append('<section><h2>Brak plików</h2><p>Umieść Excel .xlsx lub CSV w katalogu wejściowym i uruchom analizę ponownie.</p></section>') }
  foreach ($result in $results) {
    [void]$html.Append('<section><h2>' + (Escape-Html $result.File) + '</h2>')
    if ($result.Status -ne 'OK') {
      [void]$html.Append('<p>Nie przeanalizowano pliku. Sprawdź format, nagłówek, szyfrowanie i limit 50 MB. Plik źródłowy pozostał bez zmian.</p>')
    } else {
      foreach ($profile in $result.Sheets) {
        [void]$html.Append('<h3>' + (Escape-Html $profile.Sheet) + '</h3><p>Wiersze danych: ' + $profile.RowCount + '. Wiersze z kolumnami poza nagłówkiem: ' + $profile.ExtraColumnRows + '.</p>')
        if ($profile.FormulaCells -gt 0) { [void]$html.Append('<p class="note">Występują formuły. Analiza nie wykonuje ich; korzysta z zapisanych wyników, które mogą być nieaktualne.</p>') }
        if ($profile.NumericCells -gt 0) { [void]$html.Append('<p class="note">Występują komórki liczbowe. Identyfikatory i daty wymagają sprawdzenia formatu przed importem; analiza nie odtwarza formatowania Excela.</p>') }
        [void]$html.Append('<div class="scroll"><table><thead><tr><th>Pozycja</th><th>Nagłówek</th><th>Puste</th><th>Różne wartości</th><th>Powtórzenia ponad pierwsze</th></tr></thead><tbody>')
        foreach ($column in $profile.Columns) {
          [void]$html.Append('<tr><td>' + $column.Position + '</td><td>' + (Escape-Html $column.Header) + '</td><td>' + $column.Empty + '</td><td>' + $column.Unique + '</td><td>' + $column.Repeated + '</td></tr>')
        }
        [void]$html.Append('</tbody></table></div>')
      }
    }
    [void]$html.Append('</section>')
  }
  [void]$html.Append('<p class="note">Powtórzenia nazw/modeli są często poprawne. Powtórzenia identyfikatorów wymagają wyjaśnienia. Profilowanie nie kwalifikuje pozycji jako środki trwałe i nie generuje identyfikatorów.</p></body></html>')
  [IO.File]::WriteAllText((Join-Path $OutputDirectory 'summary.html'), $html.ToString(), $encoding)
  Write-Output 'Lokalny raport gotowy. Otworz summary.html w katalogu import-reports. Nie udostepniaj raportu bez przejrzenia jego naglowkow i nazw plikow.'
} catch {
  Write-Error 'Nie udalo sie wykonac lokalnej analizy. Sprawdz dostep do katalogow i parametry. Tresci plikow nie sa wypisywane.'
  exit 1
}
