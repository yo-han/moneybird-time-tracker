# Moneybird Time Tracker Stream Deck Plugin

Een handige Stream Deck plugin voor tijdregistratie en facturatie met Moneybird. Track je tijd, maak facturen en bekijk werkuren overzichten met één druk op de knop.

## 🚀 Functies

Deze plugin biedt drie handige acties:

### 1. **Time Tracker** - Start/Stop Timer

- Track je werktijd direct in Moneybird
- Real-time timer weergave op je Stream Deck knop
- Automatische pauze detectie
- Visuele feedback met verschillende iconen voor actief/inactief

### 2. **Invoice Creator** - Maak Facturen

- Genereer facturen voor gewerkte uren met één druk
- Ondersteunt verschillende periodes (maand, kwartaal, jaar)
- Wissel tussen periodes met een lange druk op de knop
- Automatische berekening van totaalbedrag

### 3. **Invoice Summary** - Uren Overzicht

- Live weergave van gewerkte uren voor geselecteerde periode
- Toont totaal aantal uren en berekend bedrag
- Automatische updates elke 30 seconden
- Handmatige refresh met een druk op de knop

## 🔧 Vereisten

- Elgato Stream Deck
- Moneybird account met API toegang
- Personal API key van Moneybird

## 📦 Installatie

### Automatische Installatie

1. Download het laatste `.streamDeckPlugin` bestand van de [Releases](https://github.com/yo-han/moneybird-time-tracker/releases) pagina
2. Dubbelklik op het gedownloade bestand
3. Stream Deck installeert de plugin automatisch

### Handmatige Installatie

1. Download het `.streamDeckPlugin` bestand
2. Open Stream Deck software
3. Ga naar het Plugins gedeelte
4. Klik op "Install Plugin"
5. Selecteer het gedownloade bestand

## 🛠 Configuratie

### Moneybird API Key verkrijgen

1. Log in op je Moneybird account
2. Ga naar **Instellingen** → **Ontwikkelaarscentrum**
3. Klik op **Persoonlijke API-tokens**
4. Maak een nieuwe API key aan met de juiste rechten:
   - Verkoop (voor facturen)
   - Tijdregistraties
   - Contacten
5. Kopieer de gegenereerde API key

### Plugin Instellen

#### Time Tracker configureren:

1. Sleep de **Time Tracker** actie naar je Stream Deck
2. Klik op de actie voor configuratie
3. Vul je Moneybird API key in
4. Selecteer je administratie
5. Kies het project waarvoor je tijd wilt tracken
6. Selecteer de gebruiker (meestal jezelf)
7. (Optioneel) Voeg een standaard omschrijving toe
8. Stel in of de tijd factureerbaar is

#### Invoice Creator configureren:

1. Sleep de **Invoice Creator** actie naar je Stream Deck
2. Configureer je API key en administratie
3. Selecteer de klant waarvoor je facturen wilt maken
4. Stel je uurtarief in
5. Kies de gewenste periode (standaard: huidige maand)
6. (Optioneel) Pas de knoptitel aan
7. (Optioneel) Selecteer een workflow voor automatische acties

#### Invoice Summary configureren:

1. Sleep de **Invoice Summary** actie naar je Stream Deck
2. Gebruik dezelfde API key en administratie
3. Selecteer de klant voor het overzicht
4. Stel je uurtarief in voor bedragberekening
5. Kies de periode voor weergave
6. (Optioneel) Pas de weergavetitel aan

## 💡 Gebruik

### Time Tracker

- **Enkele druk**: Start of stop de timer
- De knop toont de verstreken tijd tijdens het tracken
- Verschillende iconen geven de status aan:
  - Grijs: Timer staat uit
  - Groen: Timer loopt actief
  - Rood: Fout opgetreden

### Invoice Creator

- **Enkele druk**: Maakt direct een factuur voor de geselecteerde periode
- **Lange druk** (0.5 sec): Wissel tussen huidige en vorige periode
- De knop toont de geselecteerde periode
- Feedback berichten:
  - "Creating...": Factuur wordt aangemaakt
  - "✓ Created": Factuur succesvol aangemaakt
  - "No hours": Geen uren gevonden in periode
  - "Error": Fout bij aanmaken

### Invoice Summary

- Toont automatisch: `[Titel] X.X uur = €XXX`
- Updates elke 30 seconden automatisch
- **Enkele druk**: Forceer een update
- Toont "No hours" als er geen tijd is geregistreerd

## 🎯 Handige Tips

### Efficiënte Workflow Setup

1. **Dagelijkse Timer**: Plaats een Time Tracker voor je meest gebruikte project
2. **Maandelijkse Facturatie**: Zet Invoice Creator en Summary naast elkaar voor snel overzicht
3. **Multi-Client Setup**: Maak aparte profielen voor verschillende klanten

### Periode Instellingen

- **Maand**: Ideaal voor maandelijkse facturatie
- **Kwartaal**: Perfect voor grotere projecten
- **Jaar**: Handig voor jaaroverzichten

### Meerdere Instanties

Je kunt meerdere knoppen van dezelfde actie gebruiken:

- Verschillende Time Trackers voor verschillende projecten
- Invoice Creators voor verschillende klanten
- Summary knoppen voor verschillende periodes

## 🔍 Probleemoplossing

### API Key werkt niet

- Controleer of de key alle benodigde rechten heeft
- Verifieer dat de key niet is verlopen
- Test de key in Moneybird's API playground

### Geen projecten/contacten zichtbaar

- Controleer je internetverbinding
- Verifieer dat je de juiste administratie hebt geselecteerd
- Check of de contacten/projecten actief zijn in Moneybird

### Timer stopt onverwacht

- Controleer de Moneybird limieten (max. sessie duur)
- Verifieer dat het project nog actief is
- Check de Stream Deck logs voor foutmeldingen

### Factuur wordt niet aangemaakt

- Controleer of er gewerkte uren zijn in de periode
- Verifieer dat de workflow (indien ingesteld) bestaat
- Check of de contact actief is voor facturatie

## 🚨 Disclaimer

Deze plugin is een onafhankelijk ontwikkeld hulpmiddel en wordt niet officieel ondersteund door Moneybird B.V.

**Belangrijke punten:**

- Dit is geen officieel Moneybird product
- Moneybird® is een geregistreerd handelsmerk van Moneybird B.V.
- Gebruik is op eigen risico
- De plugin is niet goedgekeurd door Moneybird

## 📄 Licentie

MIT License - zie LICENSE bestand voor details

## 🤝 Bijdragen

Bijdragen zijn welkom! Maak gerust een Pull Request aan.

### Development Setup

1. Clone de repository
2. Run `npm install`
3. Gebruik `npm run dev` voor development mode
4. Test met `npm run build` voor productie build

## 📞 Support

Voor vragen of problemen:

- Open een [GitHub Issue](https://github.com/yo-han/moneybird-time-tracker/issues)
- Check de [Stream Deck Developer docs](https://docs.elgato.com/streamdeck)
- Raadpleeg de [Moneybird API documentatie](https://developer.moneybird.com/)
