# Príprava na pohovor – Innovatrics, Software Builder

**Kedy:** utorok 3. 11. 2026, 14:30, Bratislava (Biometrics House), cca 2 hodiny.
**Program:** 1. prechod zadaním (rozhodnutia, kompromisy, čo by som spravil inak), 2. systémový návrh.

---

## 1. Čo im sa páčilo (môžem sa o to oprieť)

- `PRODUCT_NOTE.md` jasne popisuje používateľa a použitie – bolo vidieť, pre koho je nástroj.
- Hlavný workflow je jednoduchý, predvídateľný a zrozumiteľný.
- Riešenie je malé, dobre ohraničené a dodané ako fungujúci celok.
- Testy UI logiky a API sú primerané, dokumentácia úprimne popisuje, čo je hotové.

## 2. Čo chcú prebrať (podľa e-mailu)

1. Zoskupovanie správ iba podľa klienta – ťažko vidieť, ktoré témy sú vybavené a ktoré nie.
2. Priorita a urgencia v reálnych situáciách – napr. keď klient opakovane urguje.
3. Niektoré vety v `CLOSE_NOTE.md` a `PRODUCT_NOTE.md` nesedia s finálnym riešením.

„Nič z toho nie je dealbreaker“ – chcú o tom hovoriť.

---

## 3. Bod 1 – Zoskupovanie správ do vlákna

### Ako to funguje teraz

- **Vlákno = jeden zákazník.** Všetky jeho e-maily, chaty a hovory sú spolu (rozhodnutie v `DECISIONS.md`, 14:05).
- Jeden vlastník na zákazníka → rieši hlavnú bolesť zo zadania: „zákazníkom sa ozvú dvaja z nás“.
- Značka „answered“ si pamätá, **po ktorú správu** bolo zodpovedané (`latest_message_id`). Keď zákazník napíše znova, vlákno sa vráti do zoznamu.

### Prečo som nezoskupoval podľa kanála

Iný kanál neznamená iného človeka ani inú tému. Ten istý zákazník (dokonca ten istý kontakt) môže napísať e-mail a potom zavolať k tej istej veci. Zadanie výslovne hovorí, že „niektorí zákazníci sa ozývajú dvakrát rôznymi kanálmi“.

### Čo je stĺpec `in_reply_to`

- Obsahuje **`id` inej správy v tej istej tabuľke**, na ktorú správa nadväzuje.
- V tabuľke sú **iba správy od zákazníkov** → nikdy to nie je naša odpoveď. Je to zákazník, ktorý pokračuje vo svojej skoršej správe (doplnenie, upresnenie, urgencia).
- Fakty zo skutočných dát (z mojich poznámok počas práce):
  - vyplnený má **76 z 340 správ**, ostatných **264** nenadväzuje na nič,
  - odkaz vždy smeruje na správu **toho istého zákazníka** (overené testom na všetkých dátach),
  - iba **24 zo 76** nadväzujúcich správ prišlo hneď po pôvodnej; medzi nimi môže byť až **9** iných správ → zákazník rieši viac vecí naraz,
  - **nevieme**, či odkaz niekedy vedie cez iný kanál (nezaznamenal som to).

### Problém, ktorý vytkli

Ak má zákazník naraz dve témy (napr. faktúra + výpadok), jedno „answered“ zavrie obe. Zo zoznamu nevidno, čo je vybavené a čo nie.

### Možnosti riešenia

| Varianta | Výhoda | Nevýhoda |
|---|---|---|
| **A. Iba podľa `in_reply_to`** (každá reťaz = téma) | presné témy | ~264 samostatných položiek; urgencia „Any update?“ bez odkazu vyzerá ako nová téma → príliš rozdrobené |
| **B. Iba podľa zákazníka** (moje riešenie) | prehľadné (22 položiek), jeden vlastník | viac tém splynie, „answered“ zavrie všetko |
| **C. Kombinácia** (čo navrhnem) | prehľad aj presnosť | trochu viac UI a jedna nová tabuľka |

### Varianta C – podrobnejšie

- **Zákazník zostáva hlavnou položkou** v zozname a má **jedného vlastníka** (zachová sa ochrana proti dvojitej odpovedi).
- Vo vnútri sa správy delia na **témy podľa reťazí `in_reply_to`**. Reťaze už v detaile vlákna zobrazujem v blokoch (`lib/thread.ts`).
- **„Answered“ sa označuje po témach**, nie za celého zákazníka. Zákazník zmizne zo zoznamu, až keď nemá žiadnu otvorenú tému.
- V zozname pri zákazníkovi: „2 otvorené témy z 5“.
- Správy bez odkazu: kolega ich vie **ručne priradiť** k existujúcej téme alebo nechať ako novú. Nie automaticky podľa textu – text je nedôveryhodný vstup od zákazníka a hádanie by mohlo niečo potichu skryť.
- Zákazníci, ktorí píšu z rôznych kanálov alebo pod rôznymi kontaktmi: systém môže **navrhnúť** spojenie, človek ho potvrdí.
- Nadväzuje na to, čo už existuje: reťaze v detaile aj `latest_message_id`. Mení sa hlavne úroveň, na ktorej sa ukladá „answered“.

### Ako to povedať

„Vlákno podľa zákazníka bolo vedomé rozhodnutie pre 3-hodinový limit – rieši hlavnú bolesť, dvojité odpovede. Cena je, že viac tém splynie. Ďalší krok by bol: zákazník ako skupina s jedným vlastníkom a vnútri témy podľa `in_reply_to`, s ‚answered‘ po témach.“

---

## 4. Bod 2 – Priorita a urgencia (opakované urgencie)

### Skutočná chyba v mojom návrhu – povedať ju sám ako prvý

- Zoznam „Waiting on us“ sa radí podľa **najnovšej** správy (`lib/waiting.ts`, funkcia `forView`).
- Stĺpec „Waiting“ tiež počíta čas od **najnovšej** správy (`web/src/pages/InboxPage.tsx`, riadok 339).
- **Dôsledok:** zákazník čaká 5 dní, dnes ráno napíše „Any update?“ → zrazu má „2 hodiny“ a spadne na **koniec** zoznamu. Čím viac urguje, tým menej naliehavo vyzerá. Presne naopak, ako by malo byť.

### Ďalšie slabé miesta

- Ak je vlákno **zabraté** a zákazník napíše znova, zostane zabraté (zámerne – aby neodpovedali dvaja). Kolega to ale **v zozname nevidí**. Zistí to až pri „answered“, keď dostane odmietnutie 409.
- Počet urgencií sa nikde nezobrazuje.
- Žiadna priorita podľa zákazníka (napr. dôležitý klient, zmluva) ani podľa obsahu.

### Riešenia

1. **Čakanie merať od najstaršej nezodpovedanej správy** (od poslednej značky „answered“), nie od najnovšej. Urgencia potom zákazníka neodsunie dole.
2. **Zobraziť počet urgencií** – odznak „urgoval 3×“ (počet správ od poslednej odpovede). Môže ovplyvniť aj poradie.
3. **Odznak „nová správa, odkedy si to zobral“** pri zabratom vlákne, aj vo filtri „Only mine“.
4. **Upozornenie, keď zabraté vlákno dlho stojí** (napr. vlastník ho má 2 dni a zákazník urguje) – vedúci alebo tím to vidí.
5. Neskôr: **SLA podľa zákazníka alebo kanála** (napr. hovor = rýchlejšia reakcia).
6. Urgencia z obsahu („blocking“, „outage“) – len ako **návrh pre človeka**, nie automatické triedenie. Text správ je nedôveryhodný.

### Ako to povedať

„Pri príprave som si všimol, že zoznam radí podľa najnovšej správy. Zákazník, ktorý urguje, tým paradoxne klesne dole. Opravil by som to meraním od najstaršej nezodpovedanej správy a pridal by som počet urgencií.“

---

## 5. Bod 3 – Poznámky nesedia s riešením

| Kde | Čo tam stojí | Ako to je v skutočnosti |
|---|---|---|
| `PRODUCT_NOTE.md` | Vlákno „čaká na nás“, keď je najnovšia správa od zákazníka. | Vlákno čaká, kým ho niekto neoznačí „answered“ (vysvetlenie nižšie). |
| `PRODUCT_NOTE.md` | Správy sa čítajú „in time order“. | Zobrazujú sa od najnovšej (zmenené o 14:44). |
| `PRODUCT_NOTE.md` | „One screen“. | Sú tam zoznam, detail vlákna a záložka „Answered“. |
| `CLOSE_NOTE.md` | Ktokoľvek môže zrušiť kolegov claim alebo zmazať „answered“. | Server to povolí iba tomu, kto vlákno zobral alebo zodpovedal. Keďže nie je prihlasovanie, stačí v hlavičke vybrať meno kolegu. Pravdivé, ale zle vysvetlené. |
| `CLOSE_NOTE.md` | „Working tree is clean.“ | Po napísaní ešte prebehli auto-commity. Drobnosť. |

### Prvý riadok vysvetlený

- **Pôvodný predpoklad:** v dátach sú správy zákazníka aj naše odpovede. Kto napísal posledný? Zákazník → čaká na nás. My → nečaká.
- **Prečo to nejde:** v tabuľke `requests` sú **iba správy od zákazníkov**. Posledná správa je vždy od zákazníka → všetkých 22 vlákien by čakalo navždy.
- **Ako to robí aplikácia:** kolega odpovie mimo aplikácie (napr. e-mailom), potom klikne „answered“. Vlákno zmizne zo zoznamu. Keď zákazník napíše znova, vráti sa.
- **Rozpor:** pravidlo som počas práce zmenil, kód je správne, ale veta v `PRODUCT_NOTE.md` zostala pôvodná.

### Ako to povedať

„Najprv som predpokladal, že v dátach sú aj naše odpovede. Keď som videl, že sú tam iba prichádzajúce správy, zmenil som pravidlo na ručné ‚answered‘. Poznámky som písal priebežne a pri zmenách rozhodnutí som ich neprepísal – to bola chyba. Poučenie: na konci porovnať poznámky s kódom, ideálne cez reviewera.“

---

## 6. Čo by som spravil inak (otázka určite príde)

- Čakanie merať od najstaršej nezodpovedanej správy (bod 2).
- Témy vnútri zákazníka a „answered“ po témach (bod 1).
- Na konci porovnať poznámky s kódom (bod 3).
- Skôr overiť pravidlo „čaká na nás“ priamo na dátach, pred napísaním product note.
- Prihlasovanie (aspoň jednoduché), aby meno bolo dôkaz – dnes si ktokoľvek vyberie hocijaké meno.
- História zmien (kto zobral, kto odpovedal, kedy) namiesto jedného prepisovaného riadku.
- Aspoň jedno skutočné preklikanie v prehliadači – počas zadania na stroji prehliadač nebol.

## 7. Systémový návrh – témy, ktoré nadväzujú na projekt

- **Príjem správ** z e-mailu, chatu a telefónu: fronta správ (message broker), idempotencia (tá istá správa dvakrát = jeden záznam), odstránenie duplicít.
- **Spájanie identity zákazníka** naprieč kanálmi (e-mail, telefónne číslo, meno firmy) – návrh + potvrdenie človekom.
- **Prihlasovanie a role** (tím, vedúci), oprávnenia na úrovni dát.
- **Súbežnosť pri „claim“** – dnes jeden atomický SQL príkaz, 409 pri konflikte. Pri väčšom rozsahu to isté (podmienený zápis / optimistické zamykanie).
- **História zmien / audit** – udalosti namiesto prepisovania.
- **Notifikácie** pri urgenciách a pri prekročení SLA.
- **Škálovanie** na viac tímov alebo zákazníkov (tenanti), vyhľadávanie na serveri.
- **Citlivé dáta** (identita / biometria): ukladať iba potrebné, nič osobné v logoch, text správ zobrazovať ako text, nie HTML.

---

## 8. Ako si aplikáciu spustiť lokálne

Pôvodný stroj s databázou už neexistuje. Lokálne beží s **vymyslenými dátami** (22 zákazníkov, 340 správ – rovnaké počty ako skutočné dáta).

1. V IDEA spusti **Server** – sám naštartuje databázu (Docker kontajner `waiting-on-us-db`, port 5433), zbuildí a spustí aplikáciu.
2. Otvor http://localhost:3000.
3. Testy: konfigurácia **Tests** (124 testov).

Potrebný je Node 26 (`/opt/homebrew/opt/node@26`). Predvolený Node 16 nefunguje.
