# Moneybird Time Tracker - Update v0.4.1

## Verbeterde Periode Selectie 🎯

### Nieuwe Manier van Periode Kiezen
In plaats van één dropdown met alle opties, heb je nu **twee aparte dropdowns**:

1. **Period Type**: 
   - Month (maand)
   - Quarter (kwartaal)
   - Year (jaar)

2. **Period Range**: 
   - This (huidige)
   - Last (vorige)

Dit geeft je meer flexibiliteit en maakt het makkelijker om snel de juiste periode te selecteren.

### Slimmere Lange Druk 🔄
De lange druk functie is nu veel slimmer:
- **Houd 0.5 seconden vast**: Wisselt alleen tussen "This" en "Last"
- Behoudt je geselecteerde periode type (month/quarter/year)
- Perfect voor snel switchen tussen huidige en vorige periode!

**Voorbeeld**: 
- Je hebt "Month" + "This" geselecteerd
- Lange druk → wordt "Month" + "Last"
- Nog een lange druk → terug naar "Month" + "This"

## Verbeterde Invoice Summary 📊

De Invoice Summary knop is nu veel flexibeler:

### Display Title Prioriteit
- **Met display title**: Toont altijd je eigen titel in plaats van de periode naam
- **Zonder display title**: Toont de periode naam (This Month, Last Quarter, etc.)

### Slimme Prijs Weergave
- **Zonder uurtarief**: Toont alleen de uren (bijv. "12.5h")
- **Met uurtarief**: Toont uren én totaalbedrag (bijv. "12.5h = €938")

**Voorbeelden**:
- Display title "Klant A" + geen uurtarief → "Klant A\n25.5h"
- Display title "Project X" + €80/uur → "Project X\n25.5h = €2040"
- Geen display title + €75/uur → "This Month\n12.5h = €938"

## Alle Functionaliteiten (v0.4.x)

### 1. Configureerbaar Uurtarief ⚙️
- **Wat**: Je kunt nu het uurtarief per knop instellen
- **Waar**: In de Property Inspector bij "Hourly Rate (€)"
- **Type**: Numeriek invoerveld
- **Standaard**: €75 per uur
- **Range**: €0 - €1000 per uur

### 2. Uitgebreide Periode Selectie 📅
Je kunt nu kiezen uit de volgende periodes voor facturatie:
- **Huidige Maand** (standaard)
- **Vorige Maand**
- **Huidig Kwartaal**
- **Vorig Kwartaal**
- **Huidig Jaar**

De geselecteerde periode wordt direct op de knop weergegeven onder de titel.

### 3. Periode Wisselen met Lange Druk 🔄
**NIEUW**: Houd de Invoice Creator knop 0.5 seconden ingedrukt om door de periodes te cyclen zonder naar de instellingen te gaan!
- **Korte druk**: Maakt factuur voor de huidige periode
- **Lange druk** (0.5 sec): Wisselt naar de volgende periode
- De knop toont kort een groen vinkje bij het wisselen
- Perfect voor als je vergeten bent de vorige maand te factureren!

### 4. Invoice Summary Preview 👁️
Een nieuwe knop type die een live preview toont van:
- Geselecteerde periode
- Totaal aantal uren
- Totale factuurbedrag

Deze knop update automatisch elke 30 seconden en kan gebruikt worden om snel te zien hoeveel uren er klaar staan voor facturatie.

## Gebruik

### Invoice Creator Knop
1. Configureer je API key, administratie en klant
2. Stel het gewenste uurtarief in
3. Kies de periode die je wilt factureren
4. Druk op de knop om de factuur aan te maken

De knop toont:
- Titel + periode (bijv. "Invoice\nThis Month")
- "Creating..." tijdens het aanmaken
- "✓ Created" bij succes
- "No hours" als er geen uren zijn
- "Error" bij problemen

### Invoice Summary Knop
1. Gebruik dezelfde configuratie als de Invoice Creator
2. De knop toont automatisch:
   - Periode naam
   - Totaal uren + bedrag (bijv. "This Month\n12.5h = €938")
3. Druk op de knop voor een manual refresh

## Technische Details

### Nieuwe Settings
```typescript
{
  hourlyRate: number;      // Uurtarief in euros
  period: string;          // current_month, last_month, current_quarter, etc.
}
```

### API Aanpassingen
- `createInvoiceFromTimeEntries()` accepteert nu een `hourlyRate` parameter
- Nieuwe periode opties worden ondersteund in de invoice creator

## Volgende Stappen

Mogelijke toekomstige uitbreidingen:
1. Custom periode selectie met datepickers
2. Verschillende uurtarieven per project/klant
3. Workflow selectie voor verschillende factuur types
4. Email verzending direct na aanmaken
5. Bulk facturering voor meerdere klanten

## Installatie

1. Build het project: `npm run build`
2. Package de plugin: `npm run package`
3. Installeer de `.streamDeckPlugin` file
4. Configureer je Moneybird API key en settings
5. Voeg de gewenste knoppen toe aan je Stream Deck
