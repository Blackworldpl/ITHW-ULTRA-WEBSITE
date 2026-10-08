# Kontrakt API IT HARDWARE

Wszystkie odpowiedzi sukcesu `{data: ...}`. Błędy `{error: "komunikat"}` + kod HTTP.
Daty ISO, kwoty decimal jako string. Listy `{items,total,page,pageSize}`. Autoryzacja cookie HttpOnly.
Mutacje JSON wymagają nagłówka `X-CSRF-Token` z GET /api/auth/me i Origin zgodnego z APP_URL.

GET /api/auth/me → SessionUser; POST /api/auth/login {email,password} → SessionUser; POST /api/auth/logout.
GET /api/setup → {available:boolean}; POST /api/setup {token,name,email,password}.
GET /api/dashboard → Dashboard; GET /api/lookups → Lookups {categories,locations,suppliers,users,serviceNowUrl}; `?only=categories,locations,suppliers,users,settings` zwraca tylko wskazane części. Pełne dane dostawców wymagają invoice.view, z samym asset.view tylko {id,name}. Pracownicy i faktury nie są częścią słowników: pickery wyszukują je przez /api/employees?q= i /api/invoices?q=.
GET /api/search?q= → SearchResult[].
GET /api/scan/resolve?code= → {href:string}; Asset ID, SN, RFID, numer środka trwałego, SKU, kod produktu lub slug. Brak dopasowania 404, niejednoznaczność 409.
GET /api/reports → Reports; GET /api/reports/shortages.csv → CSV pełnej listy braków (IT_ADVANCED/ADMIN).
GET /api/assets?q=&status=&categoryId=&locationId=&manufacturer=&model=&owner=&supplierId=&invoiceId=&purchasedFrom=&purchasedTo=&warranty=expired|soon&page=&pageSize=&after= → PageResult<Asset>. Przy domyślnym sortowaniu odpowiedź ma `nextCursor`; przekazany jako `after` zwraca następną stronę bez OFFSET (wartość `page` służy wtedy tylko do opisu).
POST /api/assets → Asset; GET/PATCH /api/assets/:assetId → Asset; GET /api/assets/:assetId/history → History[].
Asset body: name,categoryId,manufacturer?,model?,serialNumber?,macAddress?,ipAddress?,hostname?,locationId?,status?,owner?,employeeId?,sku?,productCode?,purchasedAt?,purchasePrice?,invoiceId?,warrantyUntil?,isFixedAsset?,fixedAssetNumber?,rfidTag?,notes?,customFields?. PATCH wymaga version. employeeId wskazuje aktywny profil i rozwiązuje bieżącą nazwę odbiorcy; filtry listy obsługują employeeId.
Dodatkowe filtry assets: fixed=true|false, active=true|false, noLocation=true|false, includeChildren=true|false (z locationId), warranty=expired|soon|valid|none, sort=newest|oldest|name|assetId|warranty.
GET /api/assets/export z tymi samymi filtrami → CSV (IT_ADVANCED/ADMIN), niezależny od paginacji, limit 10 000 rekordów (powyżej 413).
POST /api/assets/:assetId/actions {action,version,note?,...} → Asset. IT_USER/IT_ADVANCED/ADMIN: assign {owner}, return {status,locationId?}, note {note}. IT_ADVANCED/ADMIN: move {locationId}, status {status}, rfid {rfidTag?}. Zwrot usuwa użytkownika; wydanie wymaga stanu AVAILABLE/PREPARATION/ASSIGNED. Zmiana odbiorcy tworzy TRANSFER_ASSET z poprzednią i nową osobą, bez zmiany FV. Błędna wersja 409; ponowne wskazanie tego samego odbiorcy 400.
GET /api/inventory?q=&category=&locationId=&includeChildren=true|false&noLocation=true|false&stockState=all|low|out|ok|inStock&sort=name|sku|category|stock|minimum|shortage|location|updatedAt&direction=asc|desc&page=&pageSize=&overview=true|false → InventoryPage; POST /api/inventory → InventoryItem.
InventoryPage zachowuje `{items,total,page,pageSize}`; overview=true dodaje summary `{products,low,out,ok}` dla zakresu wyszukiwania/kategorii/lokalizacji, przed filtrem stockState. Liczniki dotyczą produktów, nie sumy jednostek. low: stock<=minimalStock (także zero), out: stock=0, ok: stock>minimalStock, inStock: stock>0. Starszy lowStock=true nadal działa, chyba że podano stockState. Wyszukiwanie łączy słowa przez AND, ignoruje wielkość liter i polskie znaki, traktuje %/_ dosłownie. Limit q 200 znaków, category 120, pageSize 1–100 (domyślnie 25); sortowanie ma stałe rozstrzygnięcie remisów po nazwie/id. Domyślny kierunek shortage/updatedAt to desc, pozostałych asc. locationId domyślnie obejmuje gałąź; razem z noLocation=true zwraca 400. Błędne filtry zwracają 400.
GET /api/inventory/facets/categories?q=&page=&pageSize= → PageResult<{name,count}>. Podpowiedzi kategorii z liczbą produktów w całym katalogu; q do 200 znaków, domyślnie 30 podpowiedzi, maksymalnie 100 na stronę. Oba odczyty wymagają inventory.view.
Body inventory: name,sku?,productCode?,slug,category,unit?,minimalStock?,locationId?,notes?,openingStock?:int 0..1000000,openingNote?,requestId?:uuid; domyślny stan = 0. Dodatni openingStock wymaga inventory.move, requestId i opisu min. 3 znaki. Jedna transakcja tworzy produkt i ruch ADJUSTMENT z autorem; requestId zabezpiecza ponowienie. PATCH nie przyjmuje pól stanu początkowego. Puste SKU/kod produktu są normalizowane do null.
Category i unit muszą dokładnie odpowiadać aktywnym wpisom słownika magazynowego; brak wpisu lub nieaktywna nowa wartość zwracają 400. PATCH może zachować dotychczasową nieaktywną wartość. Zmiana jednostki produktu z niezerowym stanem, historią ruchów lub powiązaną pozycją FV zwraca 409, także przy stanie zero. Podgląd i zatwierdzenie importu ilościowego wymagają aktywnej kategorii oraz jednostki domyślnej `szt.`. Import urządzeń pozostaje odrębnym przepływem.

## Słowniki magazynowe — 08.10.2026

GET /api/inventory/dictionaries → `{categories:InventoryDictionaryEntry[],units:InventoryDictionaryEntry[]}`, wymaga inventory.view. Zwraca także nieaktywne wpisy dla zachowania dotychczasowych wyborów; nowe formularze filtrują je do aktywnych.

GET /api/admin/inventory-dictionaries → ten sam wynik; POST /api/admin/inventory-dictionaries `{kind:category|unit,name,label,active?}` → InventoryDictionaryEntry. PATCH /api/admin/inventory-dictionaries/:id `{kind,name,label,active?,version}` → wpis. DELETE /api/admin/inventory-dictionaries/:id `{version}` → usunięty wpis. Wszystkie operacje administracyjne wymagają ADMIN i settings.manage; mutacje także CSRF/Origin. Brak lub stara wersja edycji/usunięcia: 409; brak wpisu: 404.

InventoryDictionaryEntry: `{id:uuid,kind,name,label,active,version,used}`. `used` to liczba produktów używających dokładnej wartości. `name` jest nazwą kategorii lub symbolem jednostki (do 120/30 znaków); `label` pełną nazwą (do 160). Nowa nazwa unikalna w swoim rodzaju bez względu na wielkość liter; konflikt 409. Zmiana nazwy kategorii aktualizuje istniejące produkty i ich wersje, zachowując ID/slug. Używanej jednostce można zmienić pełną nazwę/aktywność, ale nie symbol. Usunięcie używanego wpisu zwraca 409; zamiast tego można go wyłączyć. Zapisy/usunięcia są audytowane, a blokady chronią równoczesne tworzenie produktu i usuwanie wpisu.

## Operacje magazynu i zakupu
GET /api/inventory/:slug → InventoryItem; GET /api/inventory/:slug/history → History[].
PATCH /api/inventory/:slug {version,name?,sku?,category?,unit?,minimalStock?,locationId?,notes?} → InventoryItem (IT_ADVANCED/ADMIN). Stały slug; version rośnie po każdej zmianie produktu lub stanu. Konflikt wersji 409.
POST /api/inventory/:slug/correction {stock,expectedStock,note,requestId:uuid} → InventoryItem (IT_ADVANCED/ADMIN). Stan 0–10 000 000, powód minimum 3 znaki, kontrola expectedStock i idempotencja. Historia ADJUSTMENT zachowuje deltę i stan po korekcie.
POST /api/inventory/:slug/movements {delta: integer, note?:string, requestId:uuid} → InventoryItem.
GET /api/invoices → PageResult<Invoice>; GET /api/invoices/:id → InvoiceDetail.
POST /api/invoices {number,supplierId,date,amount?:money|null,currency?:3-letter ISO code,orderNumber?,notes?,items?,receive?:boolean,requestId?:uuid} → Invoice (IT_ADVANCED/ADMIN, invoice.edit). Kwota domyślnie null albo pełna suma pozycji. Przy kompletnej sumie podana amount musi być zgodna. Do 100 pozycji i 1000 urządzeń. Zapis jest atomowy; requestId chroni ponowienie.

items: {kind:asset|inventory|other,quantity,unitPrice?:money|null,name?,categoryId?,inventoryItemId?,manufacturer?,model?,locationId?,serialNumbers?,matches?}. Asset wymaga nazwy/kategorii, inventory istniejącego produktu, other nazwy. Ilości są całkowite. Lista serialNumbers może być częściowa, maksymalnie quantity; duplikaty w dokumencie są odrzucane. matches: [{serialNumber,assetId,version}] zawiera jawnie potwierdzone aktualne karty. Nowe wiersze zachowują kolejność, nazwę dokumentu i snapshot jednostki.

receive:true zwiększa produkty (inventory.move) oraz tworzy tylko nowe karty (asset.create). Istniejące SN wymagają asset.view/asset.edit i świeżego matches; zachowują stan, odbiorcę, lokalizację i wcześniejszą cenę/datę. Konflikt innej pozycji/FV albo waluty wcześniejszej ceny zwraca 409. Częściowa lista SN przyjmuje tylko wpisane nowe sztuki. Bez SN przyjęcie tworzy nieponumerowane karty, jak starszy przepływ. receive:false zachowuje nieznane numery jako planowane, bez nowych kart/ruchów.

POST /api/invoices/serial-preview {serialNumbers,invoiceId?,lineId?} → SerialPreview[] (invoice.edit, invoice.view, asset.view; CSRF). Stan new|existing|linked|conflict, SN, Asset ID/nazwa/wersja i numer konfliktowej FV. Dopasowanie bez zmiany danych, ignoruje wielkość liter i zewnętrzne spacje.
POST /api/invoices/:id/items/:lineId/serials {serialNumbers,matches?,createMissing?:boolean,version,requestId} → {linked,created}. Wymaga invoice.edit/asset.view; istniejące karty asset.edit, tworzenie asset.create. Numery i powiązania dotyczą wskazanej pozycji, suma połączeń nie przekracza quantity. Nowe karty otrzymują snapshot modelu/lokalizacji; tylko faktycznie nowe zwiększają przyjęcie. Wersja FV rośnie. Ponowienie z tym samym requestId zwraca pierwotny wynik.
POST /api/invoices/:id/items/:lineId/receive {quantity:int 1..1000000,version,requestId} → {received,remaining}. Pozycja produktu; invoice.edit i inventory.move. Częściowe przyjęcie do quantity pozycji, ruch DELIVERY i jedna dostawa FV z aktualizowaną ilością pozycji. Stale version/przekroczenie pozostałości 409; replay nie zwiększa stanu drugi raz.

PATCH /api/invoices/:id {version,number,supplierId,date,amount?:money|null,currency,orderNumber?,notes?,items?,itemPrices?:[{id,unitPrice:money|null}]} → Invoice. Pozycje można zastąpić tylko bez dostawy i powiązanego sprzętu; items i itemPrices wzajemnie wykluczone. itemPrices uzupełnia ceny dokładnie wskazanych różnych pozycji tej FV, zachowując ilości, połączenia, zapas i ceny kart urządzeń. Przy amount:null pełna suma staje się kwotą FV; niepełna pozostaje null. Zmiany cen mają audyt i kontrolę wersji. Waluty z powiązanym sprzętem nie można zmienić.

Invoice.amount oraz InvoiceLine.unitPrice: string|null. InvoiceLine zawiera position, unit, serialNumbers, manufacturer/model/locationId, inventoryItemName/inventoryItemSlug, receivedQuantity, assetIds. Asset wskazuje invoiceItemPosition/invoiceItemName. Raporty wartości urządzeń pokazują unpriced w grupach miesiąca/kontrahenta; całkowity brak cen zwraca value:null. Ceny FV nie zmieniają automatycznie cen urządzeń.

GET /api/invoices/:id/documents → InvoiceDocument[] (metadane bez zawartości).
POST /api/invoices/:id/documents → InvoiceDocument (IT_ADVANCED/ADMIN). Surowe bajty PDF, Content-Type: application/pdf, X-File-Name: nazwa zakodowana encodeURIComponent; wymagane Origin i X-CSRF-Token. Limit 10 MB, 30 PDF/FV, kontrola nagłówka/zakończenia PDF; ten sam SHA256/FV zwraca istniejący dokument. Plik i audyt zapisywane w jednej transakcji.
GET /api/invoices/:id/documents/:documentId → application/pdf z Content-Disposition: attachment. Sesja wymagana, Cache-Control: private,no-store; documentId musi należeć do wskazanej FV. PDF zawiera się w backupie PostgreSQL.
GET /api/deliveries → PageResult<Delivery>;
POST /api/deliveries {invoiceNumber,supplierId,date,orderNumber?,currency?,notes?,requestId:uuid,items:[{kind:'inventory',inventoryItemId,quantity,unitPrice}|{kind:'asset',name,categoryId,manufacturer?,model?,locationId?,quantity,unitPrice,serialNumbers?:string[]}]} → Delivery.
GET /api/qr?type=asset|inventory|location&id= → image/svg+xml (sesja wymagana).
Opcja format=png zwraca PNG 480 px z marginesem QR.
GET /api/labels/zpl?type=asset|inventory|location&id=&dpi=300&width=60&height=50 → tekst ZPL (sesja wymagana). DPI 203/300, wymiary całkowite 30–120 mm; domyślnie 300 DPI / 60 × 50 mm. Nieprawidłowy lub zbyt mały rozmiar 400. Nie wysyła zlecenia do drukarki i nie koduje RFID.
GET /api/assets/:assetId/history/export → CSV tylko tego urządzenia; GET /api/inventory/:slug/history/export → CSV tylko tego produktu. Sesja wymagana, limit 10 000 zdarzeń (powyżej 413).

GET /api/employees?q= → Employee[] (z q: do 30 profili zawierających każde słowo w nazwisku, numerze, dziale lub e-mailu; assetCount tylko z asset.view); POST /api/employees → Employee; GET/PATCH /api/employees/:id → Employee. Zapisy IT_ADVANCED/ADMIN, zmiana połączenia z kontem wyłącznie ADMIN. Body: name,employeeNumber?,email?,phone?,department?,position?,locationId?,userId?,active?,notes?,version?. Edycja wymaga poprawnej version, konflikt 409. Profil dezaktywuje się zamiast usuwać. Dezaktywacja z przypisanym sprzętem 409; wyłączenie połączonego konta ADMIN z ochroną własnego konta/administratora.
GET /api/employees/:id/equipment → {employee,assets,history}; history obejmuje do 500 zdarzeń z employeeId w przed/po. GET /api/my-equipment → dane profilu powiązanego z zalogowanym kontem albo {employee:null,assets:[],history:[]}.
POST /api/employees/:id/account {email,password,role?:VIEWER|IT_USER,version} → User, tylko ADMIN. Profil aktywny i bez konta, hasło 12–128 znaków; utworzenie i połączenie w jednej transakcji, bez sekretów w odpowiedzi/audycie. Dezaktywacja profilu z kontem wyłącza konto i odwołuje sesje; ponowna aktywacja konta pozostaje w administracji.
GET /api/admin/users → User[]; POST /api/admin/users {name,email,password,role} → User; PATCH /api/admin/users/:id {name?,email?,password?,role?,active?} → User; DELETE /api/admin/users/:id → User.
POST /api/admin/locations {name,kind?,parentId?}; POST /api/admin/categories {name,description?,fieldDefinitions?,standardFields?}; POST /api/admin/suppliers {name,...daneKontrahenta}.
PATCH /api/admin/locations/:id {name,kind?,parentId?,version?} → Location; PATCH /api/admin/categories/:id {name,description?,fieldDefinitions?,standardFields?,version?} → Category; PATCH /api/admin/suppliers/:id {name,...daneKontrahenta,version?} → Supplier.
Location zawiera version; formularz drzewa wysyła ją przy edycji. Domyślny kind nowego węzła to FOLDER; dostępne również SITE,BUILDING,ZONE,ROOM,RACK,SHELF,BIN,DESK. Kind jest opisem, dowolne typy mogą być zagnieżdżone w sobie. Pominięty parentId/kind przy PATCH zachowuje wartość, parentId:null przenosi do korzenia.
Category zawiera description,version,standardFields oraz fieldDefinitions:[{key,label,type:text|number|date|boolean|select,required,options?}]. Do 30 unikalnych kluczy pól, lista wymaga opcji. standardFields jest obiektem opcjonalnych flag boolean: manufacturer,model,serialNumber,rfidTag,locationId,owner,hostname,ipAddress,macAddress,purchasedAt,purchasePrice,invoiceId,warrantyUntil,isFixedAsset,sku,productCode,notes. Brak flagi oznacza widoczne pole; owner obejmuje profil employeeId, isFixedAsset także fixedAssetNumber. Nieznane klucze są odrzucane. Flagi konfigurują formularz, nie uprawnienia API. Formularz pomija wyłączone pola przy zapisie, więc istniejące wartości pozostają; dla ASSIGNED odbiorca jest zawsze dostępny/wymagany. Pełny zapis karty urządzenia waliduje wartości własnych pól kategorii; szybkie akcje zachowują dotychczasowe customFields.
Supplier zawiera taxId,regon,street,postalCode,city,country,contactName,email,phone,website,bankAccount,notes,version. Opcjonalne dane są obsługiwane przez POST/PATCH, pominięte pola zachowują wartości; podana version musi zgadzać się z bieżącą. NIP jest normalizowany i unikalny, WWW tylko HTTP/HTTPS. InvoiceDetail.supplier zawiera pełne dane kontrahenta.
DELETE /api/admin/locations/:id; DELETE /api/admin/categories/:id; DELETE /api/admin/suppliers/:id → usunięty wpis {id,name}.
Wszystkie operacje admin wymagają roli ADMIN. Usuwanie używanych wpisów zwraca 409 i zachowuje powiązania. Etykieta QR nie blokuje usunięcia nieużywanej lokalizacji; lokalizacji z poziomami podrzędnymi nie można usunąć. Przenoszenie lokalizacji blokuje cykle; nie wymusza kolejności typów.
Konta z historią należy dezaktywować (active:false). Własnej roli i aktywności nie można zmienić ani usunąć własnego konta; w systemie musi pozostać aktywny administrator. Zmiana e-maila, hasła, roli lub aktywności odwołuje sesje. Hasła i ich skróty nie trafiają do odpowiedzi ani audytu.
GET /api/admin/audit → History[]; GET /api/admin/inventory-export → text/csv.

GET /api/workstations → Workstation[]; POST /api/workstations {name,parentId?} → Workstation (IT_ADVANCED/ADMIN); GET /api/workstations/:id → {location,assets}. Stanowisko jest lokalizacją DESK; assetCount i lista obejmują gałąź. QR/etykieta stanowiska prowadzą do /workstations/:id. Przypisanie lokalizacji nie wydaje sprzętu pracownikowi.
GET /api/employees/:id/equipment-documents i GET /api/workstations/:id/equipment-documents → EquipmentDocumentSummary[] (do 100 najnowszych).
POST /api/employees/:id/equipment-documents {kind:equipment|clearance,notes?,requestId:uuid} i POST /api/workstations/:id/equipment-documents {kind:workstation,notes?,requestId:uuid} → EquipmentDocument (IT_USER/IT_ADVANCED/ADMIN). Osobiste urządzenia pracownika lub gałąź stanowiska; do 3000 urządzeń. Powtórzenie requestId zwraca ten sam dokument, inny aktor / cel / dane zwracają 409.
GET /api/equipment-documents/:id → EquipmentDocument; GET /api/equipment-documents/:id/html → pobierany HTML; GET /api/equipment-documents/:id/email → pobierany szkic .eml z załącznikiem HTML. Sesja wymagana, private,no-store. Dokumenty mają numer, autora, datę i niezmienny snapshot. Zapis nie zmienia stanu urządzeń ani konta; szkic nie wysyła wiadomości.

## Przebudowa produktu — 07.10.2026

Kontrakty typów: `src/shared/product.ts`; słownik permissions: `src/shared/permissions.ts`. Wszystkie poniższe endpointy poza zaproszeniem publicznym wymagają sesji; guard API sprawdza granularne uprawnienia. Mutacje wymagają CSRF/Origin. Brak uprawnień 403, brak rekordu 404, stale version lub niezgodny retry 409.

| Endpoint | Zastosowanie |
| --- | --- |
| GET /api/operations | Liczniki lokalnych zgłoszeń, konfiguracji, otwartych sesji, lokalizacji i braków, zgodne z dostępem |
| GET /api/search?q= | Ranking grup wyników; częściowe/trigramowe dopasowania, IP/MAC/RFID/QR, profile, konfiguracje i dokumenty |
| POST /api/scan/observe | `{code,requestId:uuid}`; bezpieczna identyfikacja lokalnego rekordu i zapis historii odczytu |
| GET /api/locations/:id | Lokalizacja, dzieci, 25 ostatnio zmienionych urządzeń i 10 ruchów; dane sprzętu zależne od uprawnień |
| POST /api/assets/bulk | `{action:move|assign|status,items:[{assetId,version}],locationId?,employeeId?,status?,note?,requestId}`; atomowo do 100 urządzeń |
| GET /api/assets/selection.csv?ids= | CSV zaznaczenia 1–100 Asset ID, zgodnie z asset.export |
| GET /api/assets/:assetId/configurations | Zastosowane wersje konfiguracji urządzenia |
| GET /api/configs?q=&assetId= | Lista konfiguracji; assetId jest UUID urządzenia |
| POST /api/configs; GET/PATCH /api/configs/:id | Utworzenie, treść i zapis nowej niezmiennej wersji |
| GET /api/configs/:id/download?versionId= | Pobranie dokładnej wersji tekstowej; wersja musi należeć do konfiguracji |
| POST /api/configs/:id/apply | Rejestracja zastosowania wersji na urządzeniu, bez wysyłania do urządzenia |
| GET /api/documents?q=&assetId= | Metadane plików i archiwum dokumentów wyposażenia; z filtrem assetId tylko pliki urządzenia |
| POST /api/documents?assetId=&requestId= | Bajty PDF/tekst; X-File-Name zakodowane encodeURIComponent; limity 10 MB PDF/256 KiB UTF-8 |
| GET /api/documents/:id | Autoryzowane pobranie zwykłego dokumentu; nie omija uprawnień FV/konfiguracji |
| GET/POST /api/stocktakes | Lista sesji / start `{locationId,requestId}`, snapshot do 10 000 aktywnych urządzeń w gałęzi |
| GET /api/stocktakes/:id | Szczegóły, snapshot, zdarzenia i brakujące; po zakończeniu zamrożony raport |
| POST /api/stocktakes/:id/scan | `{code,requestId}` → **`{event,scan}`**, kompaktowe zdarzenie i liczniki/version, bez pełnego snapshotu |
| POST /api/stocktakes/:id/finish | `{version}` → niezmienny raport końcowy; kolejne skany odrzucone |
| GET /api/stocktakes/:id/export | CSV raportu, wymaga inventory.run oraz asset.view |
| GET/POST /api/incidents; GET/PATCH /api/incidents/:id | Lokalny rejestr: title,description,assetId?,assignedTo?,status,priority,externalReference,version?,requestId |
| GET /api/incidents/operators | Aktywni operatorzy IT, wymaga incident.edit |
| GET/POST /api/admin/permissions; PATCH /api/admin/permissions/:id | Role bazowe i wersjonowane własne profile z tablicą permissions |
| PATCH /api/admin/users/:id/access | Przypisanie profilu uprawnień; unieważnienie sesji |
| POST /api/admin/users/invite | Zaproszenie name,email,role; odpowiedź zawiera jednorazowy link, nie wysyła wiadomości |
| GET/POST /api/invite | Podgląd tokenu / przyjęcie zaproszenia z nowym hasłem; jednorazowy token 7 dni, hash w bazie, limit prób |
| GET /api/portal | Publiczne dla zalogowanych ustawienie linku ServiceNow i integrationMode:link |
| GET/PATCH /api/admin/settings | Wersjonowany adres HTTPS ServiceNow, bez loginu/query/hash |

Status incydentu: OPEN/ASSIGNED/WAITING/RESOLVED; priorytet LOW/NORMAL/HIGH/CRITICAL. Listy zgłoszeń obsługują q,status,assetId. Role dodatkowe ograniczają uprawnienia roli bazowej; nie rozszerzają jej maksimum. Guard dostępu do stocktakes, my-equipment i szczegółów wyposażenia wymaga także asset.view.

Dokumenty wyposażenia korzystają z istniejących /api/equipment-documents/:id/html oraz /email. Pole equipmentDocument w metadanych biblioteki identyfikuje ten typ archiwum. Kopia .eml nie oznacza wysłania wiadomości.

## Zarządzane urządzenia i dashboard administratora — 07.10.2026

Typy: `src/shared/devices.ts` i `src/shared/dashboard-layout.ts`. Moduł zarządzania wymaga bazowej roli ADMIN, również przy profilach dodatkowych. Standardowe mutacje mają CSRF/Origin; optymistyczna wersja chroni edycję. Wszystkie identyfikatory urządzenia są UUID.

| Endpoint | Kontrakt |
| --- | --- |
| GET /api/devices | ADMIN + device.view; metadane i konfiguracja, bez sekretów |
| POST /api/devices | ADMIN + device.manage; `{name,kind:TV\|SCANNER,assetId?,config?}` → `{device,url,code,expiresAt}`; TV zwraca code/expiry null, kod tworzy jego przeglądarka |
| PATCH /api/devices/:id | ADMIN + device.manage; `{name,kind,assetId?,config?,version}` → device; rodzaj niezmienny |
| DELETE /api/devices/:id | ADMIN + device.manage i CSRF/Origin; `{version}` → `{deleted:true}`; trwale usuwa konfigurację i oczekujące parowania, odwołuje dostęp, zachowuje sprzęt i audyt; konflikt wersji 409, brak ekranu 404 |
| POST /api/devices/:id/pairing | ADMIN + device.manage; `{version}` → link TV bez kodu lub wcześniejszy kod/link terminala |
| POST /api/devices/:id/approve | ADMIN + device.manage i CSRF/Origin; `{code,version}` zatwierdza kod widoczny na tym TV; ponowne zatwierdzenie kodu niemożliwe |
| POST /api/devices/:id/access | ADMIN + device.manage; `{enabled,version}` → device; wyłączenie unieważnia dostęp |
| GET /api/device/:id/setup | Bez sesji; wyłącznie rodzaj TV/SCANNER; brak nazw i danych dashboardu |
| POST /api/device/:id/pairing | Tylko TV, poprawny Origin; generuje kod 15 minut i cookie losowej oczekującej przeglądarki; limit prób |
| GET /api/device/:id/pairing | Wymaga własnego cookie oczekującego TV; waiting/expired/replaced/approved; po approved zamienia cookie na sesję urządzenia i usuwa oczekujące cookie |
| POST /api/device/:id/pair | Wcześniejszy przepływ tylko SCANNER; `{code:string}` sześć cyfr; jednorazowy kod ważny 15 minut, Origin i limit prób; TV zwraca 409 |
| GET /api/device/:id | Wymaga cookie tego urządzenia; ograniczona konfiguracja, liczniki/zgłoszenia lub podsumowanie sesji; zwraca csrfToken i version |
| POST /api/device/:id/scan | Tylko sparowany SCANNER; `{code,requestId:uuid,version}` i nagłówek X-Device-CSRF oraz Origin; lookup/obserwacja lub zapis do skonfigurowanej sesji |
| GET /api/dashboard/layout | ADMIN + dashboard.configure; wyłącznie własne `{layout,version}`; nowy profil ma version 0 |
| PATCH /api/dashboard/layout | ADMIN + dashboard.configure; `{layout,version}` → własne ustawienia; brak możliwości podania innego użytkownika |

Config: `{mode,theme:light|dark,title,locationId:null|uuid,stocktakeId:null|uuid,showStats,showIncidents,message,messageLevel:INFO|WARNING|CRITICAL,refreshSeconds:5..60,tv?}`. Tryby TV: OVERVIEW/INCIDENTS/MESSAGE; SCANNER: LOOKUP/CONTINUOUS/INVENTORY. INVENTORY wymaga otwartej sesji. Dane ekranu nie zawierają profili pracowników, finansów ani operatorów i opisów zgłoszeń.

Opcjonalne tv normalizuje starsze konfiguracje do wartości domyślnych. Pełny obiekt: `{metrics,incidentStatuses,incidentPriorities,incidentFields,categoryId:null|uuid,includeChildren,incidentLimit:1..50,incidentSort:priority|newest|oldest,sectionOrder,columns:1|2|3,textSize:standard|large|xlarge,pageSize:1..12,rotateSeconds:10..120,showClock}`. Metryki: total/available/assigned/repair/preparation/damaged/disposal/openIncidents/criticalIncidents. Tablice bez duplikatów; co najmniej jeden status i priorytet; kolejność sekcji musi zawierać dokładnie message/statistics/incidents. Pola zgłoszenia: number/assetName/priority/status/updatedAt, zawsze id/title.

Odpowiedź ekranu zawiera uporządkowane metrics:[{key,value}], incidentCount zgodny z filtrami i ograniczoną listę. Wyłączone pola zgłoszeń i niezamówione wartości statystyk są pomijane w payloadzie. Lokalizacja/kategoria ograniczają sprzęt i powiązane zgłoszenia; includeChildren określa gałąź lub tylko wskazany folder. Statusy/priorytety ograniczają listę i liczniki zgłoszeń. Open/critical pomijają RESOLVED.

Cookie `ith-device-<uuid>` jest HttpOnly/SameSite=Strict/Secure w produkcji, ma Path `/api/device/<uuid>` i ważność 180 dni. Cookie oczekujące `ith-device-pending-<uuid>` ma te same zabezpieczenia i ważność 15 minut. Nie autoryzują zwykłego API. Tokeny i kody są hashowane. Potwierdzenie TV wymaga ADMIN oraz kodu z aktywnego zgłoszenia tego TV; odbiór sesji wymaga posiadania losowego cookie przeglądarki. Zatwierdzenie zastępuje poprzednią przeglądarkę. Dezaktywacja lub utrata roli ADMIN/device.manage przez administratora konfigurującego blokuje ekran. Niezgodna wersja odczytu terminala zwraca 409; klient nie może przenieść oczekującego kodu do nowej sesji.

Moduł `/locations` oraz `/api/locations/*` i `/api/admin/locations/*` wymagają ADMIN i location.manage. Wyszukiwanie modułu i jego skrót dashboardu mają to samo ograniczenie. location.view pozostaje uprawnieniem do operacyjnego wyboru lokalizacji i stanowisk; `/api/lookups` służy do formularzy i nie udostępnia operacji administracyjnych.

Layout: dziewięć wymaganych flag boolean `overview,incidents,recentAssets,activity,scanner,shortages,locations,shortcuts,deliveries`; co najmniej jedna true. Zapis w `system_settings` pod kluczem własnego konta, kontrola wersji i audyt. Nie dotyczy uprawnień do danych.

Instrukcja UI, wymagania docelowego HTTPS i weryfikacja: [MANAGED_DEVICES.md](MANAGED_DEVICES.md).

