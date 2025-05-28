# Moneybird Time Tracker - Update v0.4.0

## Nieuwe Functionaliteiten

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

### 3. Invoice Summary Preview 👁️
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
