# NBA ground truth: probability shocks and commerce responses (2024-25, 2025-26)

Compiled 2026-10-04. Companion file: `ground_truth_events.json` (74 events, 65 commerce data points, each with a URL).

## Headline verification: the Knicks won the 2026 title (confirmed)

The New York Knicks beat the **San Antonio Spurs 4-1**. They clinched with a **94-90 Game 5 win in San Antonio on June 13, 2026** (tip 8:30 p.m. ET). Jalen Brunson was Finals MVP: 45 points in the clincher and 32.6 per game for the series.

| Game | Date | Venue | Result |
|---|---|---|---|
| 1 | June 3 | San Antonio | NYK 105-95 |
| 2 | June 5 | San Antonio | NYK 105-104 |
| 3 | June 8 | MSG | SAS 115-111 |
| 4 | June 10 | MSG | NYK 107-106 (came back from 29 down) |
| 5 | June 13 | San Antonio | NYK 94-90 |

The Knicks' path:
- Beat Atlanta 4-2, clinched April 30.
- Swept Philadelphia, clinched May 10.
- Swept Cleveland, clinched May 25.

They also beat the Spurs in the December 16, 2025 NBA Cup final. Parade: June 18.

Sources: [NBA.com](https://www.nba.com/news/how-the-knicks-won-the-2026-nba-championship), [Wikipedia: 2026 NBA Finals](https://en.wikipedia.org/wiki/2026_NBA_Finals), [Fox 5 NY (parade)](https://www.fox5ny.com/news/knicks-championship-parade-set-thursday-nycs-canyon-heroes).

Also confirmed: the Thunder won the 2025 title on June 22, 2025, 103-91 over Indiana in Game 7 ([ESPN](https://www.espn.com/nba/recap/_/gameId/401766128)).

## How the JSON is built

- **`season`**: the title market mainly affected. Post-2025-Finals moves and the June 3, 2025 Thibodeau firing are tagged `2025-26`.
- **`time_et`**: tip-off for games and in-game injuries; for transactions, the ESPN/NBA.com story time stamp (noted in `detail`).
- **`injury_rival_star`**: the benefiting team is first in `teams`. Tatum (NYK) and Haliburton Game 7 (OKC) mirror own-star entries; the Williams/Mitchell ruling (SAS) appears only here.
- **Commerce `date`** is the publication date; **`lag_days_from_event`** is that date minus the event date. Shorter windows ("first 24 hours") appear in `value`.
- **UNVERIFIED** or **SECOND-HAND** in `metric` means not checked against the primary page: leads, not ground truth.

## Best case studies

Ranked by how cleanly a probability shock is separated from everything else.

### 1. Thunder rule out Jalen Williams and Ajay Mitchell before West finals Game 7 (May 29, 2026, 10:26 p.m. ET)

**Why it is a good test**
A pure rival news shock with no game that day: announced the night before Game 7, giving about 22 hours to reprice the Spurs, who did nothing themselves ([NBA.com](https://www.nba.com/news/thunder-guard-jalen-williams-hamstring-out-of-game-7-of-west-finals)).

**Commerce data**
- On June 1, the upper-level get-in for Finals games in San Antonio was about $1,000, versus about $3,000 at MSG ([Fox 7](https://fox7austin.com/news/spurs-vs-knicks-nba-finals-ticket-prices-skyrocket)).
- Bakwood BBQ reported a 500% jump in demand. Stout House saw sales up 50-75% on game nights. Several Academy stores stayed open until 3 a.m. after Game 7 ([San Antonio Report](https://sanantonioreport.org/culture-spurs-finals-run-economic-opportunity-san-antonio/)).

**Caveat:** Game 7 followed within 24 hours, so separating the news from the game needs intraday data (hourly Trends, scraped prices).

### 2. Tatum ruptures his Achilles in Game 4 at MSG (May 12, 2025, about 10 p.m. ET)

**Why it is a good test:** The Knicks' title odds jumped because a rival's star went down ([WGME/Sinclair](https://www.wgme.com/sports/content/boston-celtics-superstar-jayson-tatum-has-surgery-to-repair-ruptured-achilles-tendon-nba-playoffs-new-york-knicks)).

**Commerce data**
- Fanatics reported Knicks merchandise up 80% over the previous year's playoffs on May 21 ([Bloomberg via Fanatics](https://www.fanaticsinc.com/news/bloomberg-new-york-knicks-merchandise-sales-skyrocket-in-nba-playoff-run)).
- Brunson had the best-selling jersey in any sport since May 5 ([SI](https://www.si.com/nba/knicks/news/new-york-knicks-jalen-brunson-becoming-biggest-name-sports)).
- On May 22, NYCEDC put the value of each conference-finals home game at $91 million ([NYC.gov](https://www.nyc.gov/mayors-office/news/2025/05/mayor-adams-full-new-york-knicks-postseason-has-potential-generate-832-million-in)).
- Reporting lag was 5 to 10 days.

**Caveats:** The injury came during a win that put the Knicks up 3-1. Prices for Games 4 and 6 had already risen about 50% after the 2-0 lead ([FOS](https://frontofficesports.com/newsletter/knicks-tickets-at-super-bowl-rates/)). The Fanatics windows start May 5, too coarse to time the response.

### 3. Rivals eliminated while the Knicks were idle (May 2 and May 17, 2026)

**Why it is a good test:** On both dates the Knicks were not playing. On May 2, the No. 2 seed Celtics blew a 3-1 lead and lost Game 7 to Philadelphia. On May 17, the No. 1 seed Pistons lost Game 7 to Cleveland. Each removed a likely Knicks opponent ([NBA.com](https://www.nba.com/game/phi-vs-bos-0042500117), [NBA.com](https://www.nba.com/game/cle-vs-det-0042500207)). These are the cleanest "odds move, team does nothing" tests in the dataset.

**Commerce data:** One day after the Pistons were eliminated, FOS reported resale get-ins of about $2,500 for potential Finals games at MSG, versus about $500 for conference-finals games ([FOS](https://frontofficesports.com/article/knicks-ticket-demand-sees-msg-get-in-prices-soar/)).

**Caveat:** One snapshot, no "before" figure; needs your own daily scrape.

### 4. Knicks Finals ticket path, including a confounder (May 18 to June 13, 2026)

**Why it is a good test:** This is the densest high-frequency series in the dataset. MSG get-in prices moved as follows:
- About $2,500 on May 18.
- $3,554 on May 24 ([Fox News](https://www.foxnews.com/sports/knicks-fans-already-paying-nearly-280k-courtside-nba-finals-tickets-team-nears-historic-berth)).
- About $8,200 for Game 3 on June 4, up from $4,200 three days earlier, after the Game 1 win ([FOS](https://frontofficesports.com/knicks-get-in-prices-for-game-3-at-msg-hit-8000-and-climbing/)).
- $10,085 on June 6, after Game 2 ([Gothamist](https://gothamist.com/news/the-knicks-have-won-2-straight-and-msg-tickets-now-cost-way-more-than-your-rent)).
- After the Game 3 loss, the Game 4 get-in fell 66% over three days, to $3,898 ([Field Level Media](https://fieldlevelmedia.com/nba/nba-finals-ticket-prices-continue-to-plunge-ahead-of-game-4/)).

**The confounder:** Before Game 3 tipped, prices had already fallen from about $11,000 to under $5,000. FOS attributed that drop to security for President Trump's visit, not to the team's chances ([FOS](https://frontofficesports.com/newsletter/knicks-ticket-prices-tumble/)). That pre-game drop is a natural placebo.

**Payoff after the title:** Fanatics set records for its best 24 hours after any championship and for orders per minute (more than 8,000). Sales were more than double those for the 2020 Lakers, with a 2-day reporting lag ([Fox Business](https://www.foxbusiness.com/sports/knicks-fanatics-championship-gear-flying-off-shelves-record-fashion)).

**Caveat:** Resale is itself forward-looking, so expect it to move with the odds, not after.

### 5. Thunder sweep Memphis, and OKC hotel searches peak the next day (April 26 to 27, 2025)

**Why it is a good test:** This is a rare case where the source states a 1-day lag directly.

**Commerce data**
- Lighthouse found Oklahoma City hotel searches up 45% over the playoffs, with the peak on April 27, the day after the sweep.
- Indianapolis searches reached a 24-month high just before the Finals.
- Hotel prices barely moved: the Indianapolis Game 4 night was only 2% higher than 30 days earlier ([Hospitality Net](https://www.hospitalitynet.org/news/4127789/nba-finals-2025-how-forward-looking-search-data-reveals-the-winning-playbook-for-hotels)).
- Search intent reacts; prices lag or don't adjust. Visit Indy later reported rates up 34% on home-game nights ([IBJ](https://www.ibj.com/articles/pacers-run-to-nba-finals-bumped-downtown-foot-traffic-visitors)).

### 6. Dončić traded to the Lakers (February 2, 2025, 12:21 a.m. ET)

**Why it is a good test:** It was a total surprise, it broke after midnight with no games going on, and it shifted odds for two teams at once ([ESPN](https://www.espn.com/nba/story/_/id/43659380/sources-mavericks-trading-doncic-lakers-anthony-davis)).

**Commerce data**
- StubHub sales of Lakers tickets rose 2.5x in the first 24 hours ([NBC LA](https://www.nbclosangeles.com/news/sports/lakers-mavs-ticket-demand-for-luka-doncic/3640000/)).
- Average Lakers ticket prices were up 19% within 3 days.
- Fanatics sold out of Dončić's Lakers jersey ([KIRO7/Yahoo](https://www.kiro7.com/news/national/business-luka-how/ZYBTAZDNRGLIG4VFG7KYXWNFLA)).
- Dončić went from 8th to 1st in season jersey sales ([NBA PR](https://pr.nba.com/2024-25-season-social-media-merchandise)).

**Caveat:** The Lakers acted, so star appeal is mixed with the odds change. Use it to size "star effect" against "odds effect." Davis's adductor injury in his Dallas debut (February 8) is a follow-on shock.

### 7. Placebo: the Mavericks win the 2025 lottery with 1.8% odds (May 12, 2025)

**Why it is a good test:** 2025 title odds did not change, yet demand jumped. "$8 million in new season tickets in the three days after the lottery" ([ESPN, team source](https://www.espn.com/nba/story/_/id/45570427)), and staff were "inundated" within 24 hours ([SI/DMN](https://www.si.com/nba/mavericks/news/dallas-mavericks-lottery-luck-results-massive-ticket-corporate-sponsorship-requests-cooper-flagg)).

A negative control: commerce reacts to future value that current-season title markets don't price.

### 8. Limits: Haliburton tears his Achilles in Finals Game 7 (June 22, 2025, about 8:20 p.m. ET)

**Why it is a good test:** The in-game shock moved odds sharply toward OKC, but Game 7 tickets were already sold (cheapest $1,215 at noon, about 2.2x the Game 1 minimum; [SI](https://www.si.com/nba/nba-finals-game-7-pacers-thunder-ticket-prices)). In-game shocks can't show up in pre-sold tickets.

The July 7, 2025 confirmation that Haliburton would miss all of 2025-26 ([ESPN](https://www.espn.com/nba/story/_/id/45690127/pacers-confirm-tyrese-haliburton-miss-entire-2025-26-season)) is a slow-moving rival shock for the Knicks and Cavaliers.

**Data gap:** I found no figure from Fanatics on Thunder championship merchandise.

## Where the data is missing (so the evidence is thin)

- **Travel:** no figures from Kayak, Hopper, Expedia, airlines or Amtrak for any event. The only travel item is qualitative: Knicks fans flying to San Antonio for cheaper seats ([KSAT](https://www.ksat.com/news/local/2026/06/05/priced-out-of-msg-new-york-knicks-fans-fly-to-san-antonio-for-a-cheaper-nba-finals-experience/)).
- **Hotels:** STR and CoStar weekly data for New York and San Antonio in June 2026 is paywalled. The one item is a search snippet, flagged UNVERIFIED.
- **Thin coverage:** Thunder title merch, OKC economic impact, Butler/Fox jersey sales, ticket prices after the Irving and Curry injuries, Celtics prices around Tatum's return.
- **City estimates aren't comparable:** NYCEDC ($91M/game 2025; $90M/game and $380M total 2026), Visit San Antonio ($36.2M, assuming seven Finals games), Visit Indy (~$20M; overlaps the Indy 500).
- **Reporting lag:** most sources publish 1-10 days after the event; merch and city totals take weeks; season rankings and Colliers take months.

## Recommendation

Published reports are too sparse and delayed to test lead-lag. Collect your own daily series and align them to the JSON timestamps:
- Resale get-in prices from the SeatGeek or TickPick APIs.
- Google Trends for team-merchandise and "[city] hotel" queries.
- Public Fanatics best-seller ranks.
