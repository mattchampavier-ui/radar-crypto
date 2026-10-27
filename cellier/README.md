# Cellier

App web installable (iPhone d'abord) pour gérer une cave de 100 à 300 bouteilles rangées en armoire,
et chasser les bonnes affaires aux enchères. Cahier des charges complet : [SPEC.md](SPEC.md).

- **Front** : React + Vite + TypeScript, Tailwind CSS 4 branché sur les variables « Pierre et vert »,
  icônes Lucide, Fraunces + Inter, `vite-plugin-pwa` (manifeste, service worker, hors ligne).
- **Serveur** : Supabase (Postgres + règles d'accès par ligne, Auth par lien magique / code, Storage privé).
- **IA** : aucune dans l'app. Une tâche Claude planifiée vide la table `ai_jobs` via le connecteur
  Supabase : voir [claude/TACHE_PLANIFIEE.md](claude/TACHE_PLANIFIEE.md). Zéro clé d'API.
- **Hébergement** : Vercel.

## Arborescence

```
cellier/
├── supabase/migrations/      # schéma, RLS + rôle cellier_agent, fonctions (score du chasseur…), stockage
├── claude/TACHE_PLANIFIEE.md # essai de faisabilité + prompt de la tâche Claude
├── scripts/test-sql.mjs      # tests des migrations sur un Postgres embarqué (PGlite)
├── scripts/make-icons.mjs    # icônes et écrans de lancement iPhone
└── src/
    ├── lib/                  # données (Supabase / démo), calculs de cave, « ce soir », export
    ├── components/           # carte vin, frise de garde, feuilles du bas, barre d'onglets
    └── pages/                # Accueil, Cave, Ajouter, Fiche vin, Ce soir, Chasse, Plus…
```

## Essayer tout de suite (mode démo)

```bash
cd cellier
npm install
npm run dev          # sans variables Supabase, l'app démarre en mode démo (données fictives locales)
```

## Mise en route réelle

1. **Supabase** : créer un projet (région UE). Dans *SQL Editor*, exécuter dans l'ordre les fichiers de
   `supabase/migrations/` (ou `supabase db push` avec la CLI).
2. **Auth** : *Authentication › Providers › Email* activé. *Email Templates › Magic Link* : ajouter le
   code dans le mail, par exemple `Ou saisis ce code dans l'app : {{ .Token }}` — indispensable sur iPhone,
   car l'app installée ne partage pas sa session avec Safari. *URL Configuration* : mettre l'URL Vercel.
   Après ta première connexion, désactiver *Allow new users to sign up* : le premier compte devient le
   propriétaire unique (`claim_app`), tout autre est refusé de toute façon.
3. **Vercel** : importer le dépôt, *Root Directory* = `cellier`, variables `VITE_SUPABASE_URL` et
   `VITE_SUPABASE_ANON_KEY` (voir `.env.example`). La clé `anon` est publique par nature ; la sécurité
   repose sur les règles RLS. Aucun autre secret côté app.
4. **Tâche Claude** : suivre [claude/TACHE_PLANIFIEE.md](claude/TACHE_PLANIFIEE.md) — d'abord l'essai de
   faisabilité, puis la tâche planifiée à 12 h et 20 h.
5. **Sauvegarde hebdomadaire** (facultatif, recommandé) : secrets GitHub `CELLIER_DB_URL` (chaîne de
   connexion *Session pooler*) et `CELLIER_BACKUP_PASSPHRASE` ; le workflow `cellier-backup.yml` produit
   chaque dimanche un dump chiffré en artefact (90 jours). Il garde aussi le projet actif : l'offre
   gratuite Supabase met en pause un projet sans activité pendant 7 jours.

## Vérifications

```bash
npm run typecheck && npm test && npm run test:sql && npm run build
```

`test:sql` rejoue toutes les migrations sur PGlite et vérifie : manque par année, score et verdict,
filtres éliminatoires, dédoublonnage, droits du rôle `cellier_agent` (pas de suppression, pas de
modification des quantités), sortie de bouteille, conversion d'un lot acheté, fusion, valeur, RLS.

## Choix faits sur les points ambigus du cahier des charges

| Point | Choix | Où le changer |
| --- | --- | --- |
| Liens signés « à durée courte » alors que la tâche passe jusqu'à 12 h plus tard | Liens de 72 h, régénérés par l'app à l'ouverture quand il reste moins de 24 h | Réglages › Validité des liens photo |
| Champ « incertain » | Confiance < 0,6 → orange ; « Tout est bon » ou une correction valide la fiche | `UNCERTAIN_BELOW` |
| Lot mêlant bons et mauvais vins | Éliminé si **plus de la moitié** des bouteilles sont passées / trop jeunes, ou en état rédhibitoire | `score_hunt_lot` |
| Lieu de retrait inconnu | Pas éliminé ; la qualité d'info en tient compte | `score_hunt_lot` |
| Décote | Pleine note à 35 % sous le milieu de la fourchette de marché, × (0,5 + 0,5 × confiance) | `weights.discount_full_at` |
| Manque comblé | Part des « bouteilles-années » du lot qui tombent dans une année en manque ; × 0,6 si la couleur dépasse sa cible | `score_hunt_lot` |
| Affinité | Domaine noté ≥ 16 : 1 ; appellation : 0,6 ; région + couleur : 0,3 | Réglages › note minimale |
| Prix max conseillé | Bas de la fourchette de marché du lot, plafonné au budget ; enchère max = ce prix ÷ (1 + frais) | — |
| Calibrage | Écart entre adjudication × (1 + frais) et prix max conseillé, dès 10 prix saisis | — |
| Revalorisation mensuelle | L'app crée la demande `revalue` du mois à l'ouverture ; la tâche écrit `cellar_snapshots` | `ensure_monthly_revalue` |
| Lot acheté | Prix d'adjudication réparti par bouteille, frais en `fees_eur`, état déclaré recopié, fiche `enrich` demandée | `convert_hunt_lot` |
| Frais acheteur par défaut | 25 % TTC (à vérifier sur tes dernières ventes) | Réglages |

**Plan B si l'essai de faisabilité échoue** : si la tâche ne peut pas ouvrir les photos par lien signé,
basculer le bucket en lecture par URL publique non devinable (UUID) pour les seules photos en attente,
ou faire déposer les photos dans un dossier partagé lisible par Claude. Si elle ne peut pas écrire en
base, l'architecture IA est à revoir avant le Lot 1.

## Tester sur l'iPhone (critères d'acceptation)

**Lot 0 — Socle**
- [ ] Essai de faisabilité réussi (lecture, écriture, photo décrite, suppression refusée).
- [ ] Safari › URL Vercel › page « Installer Cellier » › Partager › *Sur l'écran d'accueil*.
- [ ] L'app s'ouvre en plein écran, l'encoche et la barre d'accueil ne masquent rien.
- [ ] Connexion avec le code à 6 chiffres reçu par mail.
- [ ] Plus › Réglages › Apparence : Clair / Sombre / Automatique.

**Lot 1 — Cave et ajout photo**
- [ ] Réglages › Armoire : saisir les clayettes et leur capacité.
- [ ] Bouton Ajouter › photo › quantité, clayette, prix, source › Ajouter : moins de 10 s, badge « En attente ».
- [ ] Après un passage de la tâche (ou lancement manuel), la fiche est remplie ; champs incertains en orange ;
      une deuxième photo du même vin propose la fusion.
- [ ] Fiche vin › État des bouteilles : niveau, étiquette, bouchon, provenance.
- [ ] Cave : vue liste / vue armoire ; taper un domaine en vue armoire surligne sa clayette ;
      glisser une ligne vers la gauche › Sortir une bouteille.

**Lot 2 — Garde, valeur et conseil**
- [ ] Fiche vin : frise de garde et prix de marché avec sources.
- [ ] Accueil : valeur estimée ; Plus › Valeur de la cave : historique (après la 1re revalorisation).
- [ ] Mode avion › Accueil › Quoi ouvrir ce soir : trois bouteilles en cave, avec leur clayette.
- [ ] « Je l'ouvre » › sortie › note dans le journal.

**Lot 3 — Chasseur**
- [ ] Chasse › coller le lien d'une vente Interenchères › lots et vins au passage suivant, avec score et verdict.
- [ ] Fiche lot › Après la vente › prix d'adjudication.
- [ ] Fiche lot › Je l'ai acheté › les bouteilles apparaissent en cave avec prix payé et état.

Le Lot 4 et le Lot 5 (V2) ne sont pas commencés : tables (`inbound_emails`) et format d'import prévus,
export CSV/JSON et sauvegarde déjà en place.
