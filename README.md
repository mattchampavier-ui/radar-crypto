# Radar crypto

Détecte chaque jour les narratifs crypto qui accélèrent dans les communautés de niche, avant qu'ils
atteignent le grand public. Outil de repérage de tendances, **pas un conseil d'investissement**.

v1 : sans X. Python, exécuté par GitHub Actions, base SQLite versionnée dans le dépôt.

## Arborescence

```
radar-crypto/
├── config/
│   ├── narratives.yaml        # taxonomie : narratifs, mots-clés, catégories, paniers de tokens
│   └── settings.yaml          # sources, poids, seuils de scoring et d'alerte, fenêtres d'envoi
├── radar/
│   ├── __main__.py            # CLI : collect | score | daily | weekly | status
│   ├── config.py              # chargement YAML + secrets (env / .env)
│   ├── db.py                  # schéma SQLite
│   ├── http.py                # session HTTP, retries/backoff
│   ├── collectors/            # un module par source, tous testés sur fixtures
│   │   ├── reddit.py          #   phase 3 (alarme) — OAuth, ou flux RSS publics sans clé
│   │   ├── github.py          #   phase 1 — nouveaux repos par mots-clés
│   │   ├── farcaster.py       #   phase 1 — Neynar, sauté si pas de clé / plan insuffisant
│   │   ├── rss.py             #   phase 1 (recherche, gouvernance), 2 (médias), 4 (presse)
│   │   ├── coingecko.py       #   prix des paniers, trending, catégories
│   │   └── defillama.py       #   TVL et revenus par catégorie
│   ├── prefilter.py           # mots-clés -> narratifs candidats, tokens mentionnés
│   ├── noise.py               # anti-bruit : promos, quasi-doublons, poids auteur et post
│   ├── process.py             # enchaîne pré-filtre, promos, doublons après chaque collecte
│   ├── classify.py            # classification Claude par lots (claude-haiku-4-5)
│   ├── scoring.py             # V, A, B, Q, SoV, D, score, phase 1-4, alertes
│   ├── tokens.py              # filtre d'exclusion des tokens
│   ├── discovery.py           # narratifs candidats (termes LLM + bigrammes en accélération)
│   ├── mailer.py              # Gmail SMTP
│   └── report/                # emails quotidien et hebdomadaire (HTML + texte)
├── tests/                     # pytest + fixtures d'API enregistrées (aucun appel réseau)
├── data/radar.db              # créée et commitée par les workflows
└── .github/workflows/
    ├── collect.yml            # toutes les 3 h : collecte + classification
    ├── daily.yml              # 7h30 Paris : scoring de la veille + email
    ├── weekly.yml             # lundi 8h Paris : récap
    └── tests.yml              # tests à chaque push
```

## Plan d'implémentation (état)

| Étape | Contenu | État |
|---|---|---|
| 1. Socle | config YAML, schéma SQLite, HTTP commun | ✅ |
| 2. Collecteurs | Reddit, GitHub, Farcaster, RSS, CoinGecko, DefiLlama — testés un par un sur fixtures | ✅ (test live à faire, cf. plus bas) |
| 3. Traitement | pré-filtre mots-clés, tokens, promos, quasi-doublons, poids auteur | ✅ |
| 4. Classification | Claude par lots, sorties structurées, repli mots-clés, termes émergents | ✅ |
| 5. Scoring | formules du cahier des charges, phases, alertes (≤ 2/jour, carence 7 j) | ✅ |
| 6. Livrables | email quotidien, récap hebdo, filtre d'exclusion des tokens | ✅ |
| 7. Automatisation | workflows GitHub Actions, commit de la base | ✅ |
| 8. Mise en route | secrets, test live de chaque collecteur, 14 jours de données propres | ⏳ à toi |
| 9. Backtest | `python -m radar score --days N` recalcule tout l'historique | après 30+ jours |

## Mise en route

### 1. Secrets GitHub (Settings → Secrets and variables → Actions)

| Secret | Obligatoire | Où l'obtenir |
|---|---|---|
| `ANTHROPIC_API_KEY` | recommandé | console.anthropic.com. Sans clé : repli sur les mots-clés |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | non | Reddit exige désormais une validation préalable de l'accès API (Responsible Builder Policy). **Sans ces secrets, le radar lit les flux RSS publics des subreddits** (sans score ni âge des comptes). Une fois l'accès obtenu : reddit.com/prefs/apps → app de type **script**, redirect uri `http://localhost:8080` |
| `REDDIT_USER_AGENT` | non | ex. `radar-crypto/0.1 by u/ton_pseudo` |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | oui | Compte Google → Sécurité → validation en 2 étapes → **Mots de passe d'application** |
| `EMAIL_TO` | non | destinataires séparés par des virgules (défaut : `GMAIL_USER`) |
| `NEYNAR_API_KEY` | non | neynar.com. Si absente ou si le plan gratuit refuse l'endpoint, Farcaster est sauté |
| `COINGECKO_API_KEY` | non | clé « Demo » gratuite sur coingecko.com/en/api, limites plus confortables |

`GITHUB_TOKEN` est fourni automatiquement par Actions (recherche GitHub à 30 req/min).

Vérifier aussi : Settings → Actions → General → Workflow permissions → **Read and write**.

### 2. Tester chaque collecteur en local

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # renseigner les clés (le fichier n'est jamais commité)

python -m pytest -q             # 22 tests, sans réseau

# Un collecteur à la fois, dans une base jetable, avec un échantillon de ce qui a été collecté :
python -m radar --db /tmp/test.db collect --only github --sample 10
python -m radar --db /tmp/test.db collect --only reddit --sample 10
python -m radar --db /tmp/test.db collect --only rss --sample 10
python -m radar --db /tmp/test.db collect --only farcaster --sample 10
python -m radar --db /tmp/test.db collect --only coingecko
python -m radar --db /tmp/test.db collect --only defillama
python -m radar --db /tmp/test.db status

# Aperçu des emails sans envoi (écrit out/daily.html et out/weekly.html) :
python -m radar --db /tmp/test.db daily --dry-run
python -m radar --db /tmp/test.db weekly --dry-run
# Envoi réel immédiat (test Gmail) :
python -m radar --db /tmp/test.db daily --force
```

Les URLs des flux RSS et les ids CoinGecko des paniers sont une liste de départ : le premier
passage signale les flux en erreur et les ids introuvables (section « Santé de la collecte »).

Depuis GitHub : Actions → « Collecte » → Run workflow, avec `only = github` par exemple.

### 3. Horaires

GitHub Actions ne connaît que l'UTC. Chaque email a deux crons (heure d'été / d'hiver) ; le script
n'envoie que dans la fenêtre horaire de Paris (`email.daily_window`, `email.weekly_window`) et une
seule fois par jour (table `email_log`). Les retards de cron GitHub (souvent 5 à 30 min) sont absorbés.

## Scoring (rappel)

- **M** : somme des poids des posts du jour = w_source (niche 3, influenceur 1,5, Reddit 1, suspect 0)
  × w_type (analyse/annonce 1, promotion 0,3, spam 0) × w_auteur (compte < 90 j → 0) × pénalités
  (promo 0,5, quasi-doublon 0, repo sans étoile 0,5).
- **V** = MA7/MA30 (plancher : MA30 ≥ 1), **A** = V − V(t−7), **B** = auteurs 7 j / (auteurs 30 j / 30 × 7)
  × (1 − pénalité si 5 comptes récurrents > 40 %), **Q** = part niche sur 7 j, **SoV** = part de voix sur 7 j,
  **D** = z(V) − z(R7 du panier).
- **Score** = 0,30 z(V) + 0,15 z(A) + 0,20 z(B) + 0,20 z(Q) + 0,15 D − pénalités (un seul token, aucune source niche).
  z-scores sur l'historique propre du narratif ; pendant les 14 premiers jours, repli sur un z-score
  entre narratifs (drapeau « historique court »).
- **Phase** : 4 si ≥ 3 articles de presse généraliste sur 7 j ; 3 si pic Reddit (MA7/MA30 ≥ 2) ou
  CoinGecko trending ; 1 si Q > 50 % et Reddit faible ; 2 sinon.
- **Alerte** : score dans le décile supérieur de l'historique du narratif (seuil fixe 1,5 avant 20 jours)
  ET phase 1-2 ET divergence positive ET au moins une source niche. Au plus 2 par jour, pas de
  nouvelle alerte sur le même narratif avant 7 jours. **Alerte de retard** : passage en phase 3 ou 4.

Tous les paramètres sont dans `config/settings.yaml`. Le scoring est recalculé à partir des posts,
donc reproductible : `python -m radar score --date 2026-12-01 --days 60` rejoue 60 jours (backtest).

## Limites connues de la v1

- Pas de X : la phase 2 « influenceurs » est approchée par les médias crypto spécialisés.
- Pas de Google Trends : la phase 4 repose sur les flux RSS de presse généraliste.
- Filtre d'exclusion partiel : offre en circulation et liquidité automatiques ; concentration des
  portefeuilles, déblocages et source du rendement restent à vérifier à la main.
- Base SQLite dans git : simple, mais l'historique du dépôt grossit (≈ 8 commits/jour). Les textes
  sont tronqués et la base compactée à chaque commit ; à migrer vers une base hébergée si besoin.
- Pas d'âge de compte Farcaster via Neynar : on utilise le ratio abonnés/abonnements.
