# Cahier des charges — Cave & Chasseur de vin

## 1. Vision et périmètre

Une app web installable sur iPhone, au nom de travail **Cellier**, qui gère une cave de 100 à 300 bouteilles rangées en armoire à vin, et qui chasse les bonnes affaires aux enchères et sur Leboncoin. La saisie se fait par photo. L'IA ne tourne pas dans l'app : une tâche Claude planifiée, sur l'abonnement Claude existant, traite les photos et les lots en différé. Aucun appel API payant.

**V1, livrée en premier :**

- inventaire de la cave, par clayette de l'armoire ;
- ajout par photo d'étiquette : la photo part dans une file d'attente, la fiche est remplie au passage suivant de la tâche Claude ;
- état de chaque bouteille (niveau, étiquette, bouchon, provenance) ;
- fenêtres de garde, prix de marché estimé et valeur totale de la cave ;
- « Quoi ouvrir ce soir », calculé dans l'app à partir des fiches déjà enrichies ;
- journal de dégustation ;
- le chasseur, en mode lien de vente collé.

**V2, ensuite :** lecture automatique des alertes Interenchères transférées, import des analyses Leboncoin, digest hebdomadaire par mail, statistiques.

**Hors périmètre :** revente, multi-caves, partage, enchères automatiques. L'app ne place jamais d'enchère et ne paie rien.

## 2. Contexte d'usage et hypothèses

Un seul utilisateur, sur iPhone d'abord, sur ordinateur à l'occasion. Les paramètres ci-dessous sont modifiables dans les Réglages et ne doivent jamais être codés en dur.

| Paramètre | Valeur de départ |
| --- | --- |
| Utilisateur | Une seule personne |
| Taille de la cave | 100 à 300 bouteilles |
| Rangement | Une armoire à vin ; emplacement à la clayette, sans position exacte |
| Consommation | 4 à 8 bouteilles par mois (6 par défaut) |
| Objectif d'achat | Vins à boire, ouverture dans 1 à 10 ans ; pas de placement |
| Budget par lot | 300 à 1 000 € |
| Zone de retrait | Lyon et Auvergne-Rhône-Alpes (Lyon, Bourgogne, Rhône, Jura, Savoie) |
| Horizon de veille | Le mois à venir |
| Frais acheteur | Taux par défaut paramétrable, surchargé par vente quand il est connu |
| IA | Tâche Claude planifiée sur l'abonnement ; 0 € d'API |

**Usage type.** Photographier trois bouteilles au retour d'une vente en moins d'une minute, et retrouver leurs fiches remplies le soir même. Choisir une bouteille en dix secondes devant l'armoire.

## 3. Architecture

*(schéma : app, serveur, 4 sources externes)*

L'app ne fait aucun appel d'IA. Elle dépose ses demandes (photo à lire, lien de vente à analyser) dans une file d'attente sur le serveur. Deux fois par jour, ou quand tu la lances depuis l'app Claude, une tâche Claude planifiée vide cette file : elle lit la base via le connecteur Supabase, consulte le web, puis écrit fiches, prix et verdicts. Tout passe par ton abonnement Claude, sans clé d'API.

## 4. Écrans et fonctionnalités

Navigation par une barre d'onglets en bas d'écran, cinq entrées : **Accueil · Cave · Ajouter · Chasse · Plus**. Le bouton Ajouter, au centre, ouvre directement l'appareil photo.

### 4.1 Accueil

- Bandeau « À boire maintenant » : bouteilles dans leur fenêtre, triées par urgence (fin de fenêtre la plus proche d'abord).
- Bouton « Quoi ouvrir ce soir ».
- File d'attente IA : nombre de photos et de liens en attente, heure du prochain passage.
- Alertes : bouteilles qui entrent ou sortent de leur fenêtre ce mois-ci, lots suivis dont la vente est dans moins de 7 jours.
- Trois chiffres : bouteilles en cave, valeur estimée de la cave, mois de consommation couverts au rythme réglé.

### 4.2 Cave

- **Vue liste** : vignette d'étiquette, domaine, cuvée, millésime, quantité, pastille de couleur du vin, statut de garde, badge « En attente » tant que la fiche n'est pas enrichie.
- **Vue armoire** : une ligne par clayette avec le nombre de bouteilles et leur liste ; une recherche surligne la clayette de la bouteille trouvée.
- Recherche plein texte, filtres (couleur, région, appellation, millésime, statut de garde, prix) et tris.
- Glisser une ligne vers la gauche : « Sortir une bouteille » (décrémente et ouvre le journal de dégustation).

### 4.3 Ajouter (photo)

1. L'appareil photo s'ouvre ; une ou plusieurs photos (étiquette, contre-étiquette).
2. L'utilisateur choisit seulement la quantité, la clayette, le prix payé et la source (vente, caviste, cadeau). Dix secondes, rien d'autre à saisir.
3. La bouteille apparaît tout de suite en cave avec sa photo et le badge « En attente ».
4. Au passage suivant de la tâche Claude, la fiche se remplit : identité, fenêtre de garde, accords, prix de marché. Les champs incertains sont signalés en orange pour vérification.
5. Si le vin existe déjà en cave, la tâche propose la fusion avec le lot existant, à valider dans l'app.

Saisie manuelle disponible en secours, avec autocomplétion sur les vins déjà en cave.

### 4.4 Fiche vin

- Photo de l'étiquette, identité complète, cépages, fenêtre de garde sous forme de frise (avant, apogée, déclin) avec l'année en cours repérée.
- **État de la bouteille** : niveau (dans le col, haut d'épaule, mi-épaule, bas d'épaule), étiquette, capsule et bouchon, provenance et conditions de stockage connues.
- **Prix de marché** : estimation de la tâche Claude, avec sources, date et niveau de confiance ; valeur de la ligne = prix × quantité.
- Accords mets et vins, température de service, carafage.
- Historique : achats (date, prix, source), sorties, notes de dégustation.
- Bouton « Réévaluer » : remet le vin dans la file pour une nouvelle estimation.

### 4.5 Quoi ouvrir ce soir

Calculé dans l'app, sans IA, donc instantané et disponible hors ligne. L'utilisateur choisit un type de plat dans une liste (viande rouge, volaille, poisson, fromage, dessert…), l'occasion et un éventuel plafond de prix. L'app croise ce choix avec les accords enregistrés dans chaque fiche, garde les bouteilles en fenêtre et propose les trois meilleures : en priorité celles en fin de fenêtre, chacune avec sa raison et sa clayette.

### 4.6 Chasse

- Champ « Coller un lien de vente » en haut de l'écran : le lien part dans la file, l'analyse arrive au passage suivant.
- Liste des lots analysés, triée par intérêt, avec un verdict par lot : **À viser**, **À surveiller**, **À ignorer**.
- **Fiche lot** : photo, descriptif, vins du lot (un lot peut en contenir plusieurs), état déclaré des bouteilles, estimation de la maison, prix maximum conseillé frais compris avec sources, raison du verdict, manque comblé dans la cave, dates de vente et de retrait.
- **Après la vente** : saisie du prix d'adjudication réel, même pour un lot non acheté ; c'est ce qui permet de juger la justesse des prix conseillés.
- Un lot acheté se transforme en bouteilles en cave en un geste, avec le prix payé et l'état déclaré.

### 4.7 Plus

- **Journal** : dégustations, avec note sur 20 et commentaire.
- **Valeur de la cave** : total estimé, évolution dans le temps, écart avec le prix payé.
- **Réglages** : paramètres de la section 2, structure de l'armoire, rythme de consommation et cibles de stock, export CSV et JSON, mode clair ou sombre.

## 5. L'IA : une tâche Claude planifiée

Toute l'intelligence de l'app vit dans une tâche Claude planifiée, qui tourne sur l'abonnement Claude existant. L'app, elle, ne fait que déposer des demandes et afficher des résultats. Coût d'API : zéro. Contrepartie : un délai de quelques heures, et une consommation qui compte dans les limites d'usage de l'abonnement.

### 5.1 Fonctionnement

1. L'app crée une ligne dans la table `ai_jobs` : type de demande, référence (bouteille ou lot), statut « en attente ».
2. La tâche Claude tourne à 12 h et 20 h, et peut être lancée à la main depuis l'app Claude.
3. Elle lit les demandes en attente via le connecteur Supabase, traite chacune, écrit le résultat dans les tables concernées et passe la demande à « fait » ou « erreur » avec un message.
4. L'app affiche les résultats au prochain rafraîchissement ; rien n'est validé sans l'utilisateur pour les champs incertains.

### 5.2 Types de demandes

| Type | Déclenchée par | Ce que fait la tâche |
| --- | --- | --- |
| `label` | Ajout d'une bouteille par photo | Lit l'étiquette, remplit l'identité, propose une fusion si le vin existe |
| `enrich` | Fin de `label`, ou bouton « Réévaluer » | Fenêtre de garde, accords, service, prix de marché avec sources et confiance |
| `lot_url` | Lien de vente collé | Lit la page, extrait les lots et leurs vins, rend un verdict par lot |
| `revalue` | Automatique, une fois par mois | Met à jour le prix de marché des vins en cave, donc la valeur de la cave |

### 5.3 Règles communes

- **Sortie structurée** dans les colonnes prévues ; un résultat incomplet est marqué, jamais complété au hasard.
- **Ne jamais inventer** : un champ illisible reste vide avec une confiance basse.
- **Sources citées** pour tout prix ou fenêtre trouvé en ligne : URL et date de consultation.
- **Prix de marché** : recherche web de la tâche, cote iDealwine en priorité quand elle existe, sinon prix de cavistes et résultats d'enchères ; toujours une fourchette et un niveau de confiance.
- **Sobriété** : une seule recherche par vin, résultats réutilisés pour les bouteilles identiques ; au maximum 20 demandes traitées par passage, le reste au passage suivant.

### 5.4 À valider avant tout développement

Le Lot 0 commence par un essai de faisabilité : vérifier qu'une tâche Claude planifiée peut lire et écrire dans la base via le connecteur Supabase, et qu'elle peut ouvrir une photo du stockage (par un lien signé à durée courte). Si l'un des deux échoue, on revient sur ce choix avant d'écrire l'app.

## 6. Le chasseur

Le chasseur transforme une vente ou une annonce en verdict par lot, à partir de ta cave et de tes règles. Il ne fait jamais d'enchère.

### 6.1 Sources

| Source | Version | Fonctionnement |
| --- | --- | --- |
| Lien de vente collé | V1 | L'URL d'une vente ou d'un lot part dans la file ; la tâche Claude lit la page et extrait les lots |
| Alertes Interenchères | V2 | Un filtre Gmail transfère automatiquement les alertes vers une adresse de réception de l'app ; chaque mail reçu crée une demande dans la file. Aucune connexion à Gmail, donc aucune reconnexion à faire |
| Analyse Leboncoin | V2 | Claude dans Chrome produit un JSON (format ci-dessous), collé dans « Importer une analyse Leboncoin » |

Chaque lot est dédoublonné (même vente et même numéro de lot, ou même annonce). Un lot peut contenir plusieurs vins, chacun avec son millésime, sa quantité et son état déclaré.

### 6.2 Ce qui « manque » dans la cave

Le manque se calcule à partir du rythme de consommation, 6 bouteilles par mois par défaut, soit 72 par an. Pour chacune des dix années à venir, l'app compte les bouteilles qui seront dans leur fenêtre cette année-là. Une année sous 72 bouteilles est une année en manque, et un lot qui la comble gagne des points. La répartition par couleur suit une cible réglable, initialisée sur la composition actuelle de la cave.

### 6.3 Règles de tri

**Filtres éliminatoires** (le lot passe en « À ignorer ») :

- prix probable frais compris au-dessus du budget maximum par lot ;
- retrait hors de la zone définie ;
- vente au-delà de l'horizon de veille ;
- vins déjà passés, ou pas buvables avant 10 ans ;
- état déclaré rédhibitoire (niveau bas d'épaule ou moins, bouchon qui remonte).

**Score d'intérêt** pour les lots restants, sur 100 :

- **Décote (40 points)** : écart entre le coût probable frais compris (estimation basse de la maison + frais) et la fourchette de marché trouvée par la tâche Claude. Points réduits si la confiance sur le prix est basse.
- **Manque comblé (30 points)** : selon la section 6.2.
- **Affinité (20 points)** : domaines, appellations ou styles notés 16 sur 20 ou plus dans le journal.
- **Qualité de l'information (10 points)** : photos, provenance, niveaux indiqués.

**Verdict** : « À viser » au-dessus de 70, « À surveiller » entre 45 et 70, « À ignorer » en dessous. Pondérations et seuils réglables.

**Calibrage** : à partir de dix prix d'adjudication saisis, l'écran Chasse affiche l'écart moyen entre prix conseillé et prix réel, pour ajuster le taux de frais et les seuils.

### 6.4 Format d'import Leboncoin (V2)

```json
{
  "source": "leboncoin",
  "analysed_at": "2026-10-23",
  "items": [
    {
      "url": "https://www.leboncoin.fr/...",
      "title": "...",
      "price_eur": 450,
      "location": "Villeurbanne (69)",
      "wines": [{ "producer": "...", "appellation": "...", "vintage": 2015, "quantity": 6 }],
      "seller_notes": "Conservé en cave enterrée",
      "photos": ["https://..."]
    }
  ]
}
```

### 6.5 Digest (V2)

Chaque dimanche à 19 h, un mail : les lots « À viser » des semaines à venir, avec prix maximum conseillé, date de vente et date de retrait. Pas de notification push en V1 ni en V2 : elles sont peu fiables pour une app web sur iPhone.

## 7. Modèle de données

Une base Postgres (Supabase), une ligne par vin de référence et une ligne par lot de bouteilles en cave. Toutes les tables sont protégées par des règles d'accès par ligne ; la tâche Claude passe par un rôle dédié, limité aux tables qu'elle doit lire et écrire.

| Table | Rôle | Champs clés |
| --- | --- | --- |
| `wines` | Vin de référence (domaine + cuvée + millésime + format) | producer, cuvee, appellation, region, country, vintage, color, grapes[], bottle_size_cl, classification, drink_from, drink_peak, drink_until, serving_temp_c, decant_min, pairings[] (types de plats), confidence (par champ), status (en attente, enrichi, à vérifier) |
| `market_prices` | Historique des prix de marché | wine_id, low_eur, high_eur, confidence, sources[] (URL + date), checked_at |
| `cabinet_shelves` | Clayettes de l'armoire | shelf_number, label, capacity |
| `stock_lots` | Bouteilles d'un vin sur une clayette | wine_id, shelf_id, quantity, label_photo_paths[], fill_level, label_condition, capsule_cork_condition, provenance, added_at |
| `purchases` | Achats | wine_id, date, quantity, unit_price_eur, fees_eur, source (vente, caviste, cadeau, leboncoin), hunt_lot_id |
| `movements` | Entrées, sorties, déplacements | stock_lot_id, type, quantity, date, reason |
| `tastings` | Journal de dégustation | wine_id, date, score_20, notes, occasion, dish_type |
| `hunt_lots` | Lots repérés | source, url, sale_house, sale_date, pickup_date, location, lot_number, description, photos[], estimate_low_eur, estimate_high_eur, fees_rate, max_bid_eur, score, verdict, reason, gap_filled, hammer_price_eur, status (nouveau, suivi, acheté, ignoré) |
| `hunt_lot_wines` | Vins d'un lot | hunt_lot_id, producer, appellation, vintage, quantity, fill_level, condition_notes, wine_id (si déjà connu) |
| `inbound_emails` | Alertes reçues (V2) | received_at, sender, subject, body, processed |
| `ai_jobs` | File d'attente de la tâche Claude | type (label, enrich, lot_url, revalue), ref_id, status (en attente, en cours, fait, erreur), message, created_at, done_at |
| `cellar_snapshots` | Valeur de la cave dans le temps | date, bottles, value_low_eur, value_high_eur, purchase_value_eur |
| `settings` | Paramètres de la section 2 | budget_min, budget_max, zone[], horizon_days, default_fees_rate, monthly_consumption, color_targets, weights, thresholds, theme |

Les photos d'étiquette et de lots sont stockées dans un espace de fichiers privé, avec une miniature générée à l'envoi.

## 8. Identité visuelle « Pierre et vert »

L'ambiance d'une cave naturelle : fond pierre claire, vert bouteille pour l'action, liège pour l'accent. Le vin lui-même apporte la couleur, par les étiquettes et les pastilles. Toutes les couleurs sont des variables CSS, avec un thème sombre fourni dès la V1.

### 8.1 Couleurs

| Variable | Clair | Sombre | Usage |
| --- | --- | --- | --- |
| `--bg` | #F4F1EA | #161A17 | Fond d'écran (pierre claire / cave de nuit) |
| `--surface` | #FBFAF6 | #1F2420 | Cartes, feuilles |
| `--surface-2` | #ECE7DC | #283029 | Zones secondaires, champs |
| `--line` | #DDD6C8 | #343C35 | Séparateurs, bordures |
| `--text` | #24271F | #ECE9E1 | Texte principal |
| `--text-muted` | #6E6A5E | #A29E92 | Texte secondaire |
| `--primary` | #2F4A3A | #7FA68A | Vert bouteille : boutons, onglet actif |
| `--primary-soft` | #DCE5DD | #263A2D | Fonds de sélection |
| `--accent` | #A9824E | #C9A46E | Liège : badges, mises en avant |
| `--ok` | #4E7A4F | #7DB07E | « À boire », « À viser » |
| `--warn` | #B7862C | #D9AE55 | « À surveiller », champ IA incertain |
| `--danger` | #9E4A35 | #D97A62 | « Passé », erreurs |

**Pastilles de couleur du vin** (identiques en clair et en sombre) : rouge #6E2232, blanc #D8C27A, rosé #E2A99A, effervescent #E6D8A8, liquoreux #C08A2E.

### 8.2 Typographie

- **Titres** : Fraunces (Google Fonts), graisse 500 à 600, pour le caractère « étiquette ».
- **Texte et interface** : Inter, 15 à 17 px sur iPhone, jamais sous 13 px.
- **Chiffres** : Inter en chiffres tabulaires pour prix, millésimes et quantités.

### 8.3 Composants

- **Carte vin** : vignette d'étiquette à gauche (ratio 3:4, coins 10 px), domaine en titre, cuvée et appellation dessous, millésime en badge liège, pastille couleur, quantité à droite.
- **Frise de garde** : barre horizontale en trois zones (avant, apogée, déclin), un repère pour l'année en cours.
- **Badge de verdict** : pilule pleine, vert « À viser », ocre « À surveiller », gris « À ignorer ».
- **Feuilles du bas** pour les actions (sortir une bouteille, déplacer, acheter), à la manière d'iOS.
- **Barre d'onglets** translucide avec flou d'arrière-plan, icônes Lucide en trait de 1,75.
- **Formes** : coins 14 px pour les cartes, 999 px pour les pilules ; grille de 8 px ; ombres très légères en clair, aucune en sombre.
- **Mouvement** : transitions de 150 à 200 ms, désactivées si l'iPhone demande de réduire les animations.

## 9. Exigences iPhone, sécurité, performance

L'iPhone est la cible principale : chaque écran est conçu d'abord pour une largeur de 375 à 430 px, puis élargi pour l'ordinateur.

### 9.1 iPhone et installation

- App web installable : manifeste, icônes (dont `apple-touch-icon` 180 px), écran de lancement, affichage `standalone`, couleur de barre d'état assortie au thème.
- Installation depuis Safari, via Partager puis « Sur l'écran d'accueil » ; une page d'aide l'explique au premier lancement.
- Respect des zones sûres (encoche, barre d'accueil) avec `env(safe-area-inset-*)`.
- Zones tactiles d'au moins 44 × 44 px ; aucun survol nécessaire ; champs en 16 px minimum pour éviter le zoom automatique de Safari.
- Appareil photo ouvert directement depuis le bouton Ajouter (`<input type="file" accept="image/*" capture="environment">`) ; photos compressées dans le téléphone avant envoi (1 600 px max, JPEG).
- Consultation de la cave et « Quoi ouvrir ce soir » disponibles hors ligne, en lecture seule ; les ajouts demandent du réseau.

### 9.2 Sécurité

- Connexion par lien magique envoyé par mail ; un seul compte.
- Règles d'accès par ligne sur toutes les tables ; espace photos privé, liens signés à durée courte.
- Aucune clé d'API Anthropic. La tâche Claude passe par le connecteur Supabase avec un rôle limité aux tables nécessaires.
- Adresse de réception des alertes (V2) : n'accepte que les mails venant de l'expéditeur Interenchères, ignore le reste.
- Secrets dans les variables d'environnement, jamais dans le code ni dans le dépôt.

### 9.3 Performance et fiabilité

- Premier affichage en moins de 2 secondes en 4G ; liste de 300 bouteilles fluide.
- Ajout d'une bouteille en moins de 10 secondes, photo comprise.
- Export complet CSV et JSON à tout moment, et sauvegarde automatique hebdomadaire de la base.
- La tâche quotidienne garde le projet actif ; vérifier la politique de mise en pause des projets inactifs de l'offre gratuite Supabase.

## 10. Lots de livraison et critères d'acceptation

La V1 tient en quatre lots, chacun utilisable seul ; deux lots suivent en V2. Claude Code ne passe au suivant qu'une fois les critères du précédent validés sur un vrai iPhone.

### Lot 0 — Socle et essai de faisabilité

- [ ] Une tâche Claude planifiée lit et écrit une ligne de test dans la base via le connecteur Supabase
- [ ] La même tâche ouvre une photo du stockage privé par lien signé et en décrit le contenu
- [ ] Projet déployé en ligne, connexion par lien magique fonctionnelle
- [ ] Thèmes clair et sombre conformes à la section 8
- [ ] App installée sur l'écran d'accueil de l'iPhone, en plein écran, zones sûres respectées

### Lot 1 — Cave et ajout photo

- [ ] Clayettes de l'armoire saisies dans les Réglages
- [ ] Ajout d'une bouteille par photo en moins de 10 secondes, badge « En attente »
- [ ] Au passage de la tâche, fiche remplie, champs incertains en orange, fusion proposée en cas de doublon
- [ ] État de la bouteille saisissable et visible sur la fiche
- [ ] Vues liste et armoire, recherche qui surligne la clayette, sortie par glissement

### Lot 2 — Garde, valeur et conseil

- [ ] Fenêtre de garde et prix de marché avec sources, frise sur la fiche
- [ ] Valeur de la cave à l'accueil, mise à jour mensuelle et historique
- [ ] « Quoi ouvrir ce soir » hors ligne, 3 bouteilles réellement en cave avec leur clayette
- [ ] Journal de dégustation relié aux sorties

### Lot 3 — Chasseur, lien collé

- [ ] Lien de vente collé → lots et vins extraits au passage suivant
- [ ] Score et verdict calculés par une fonction SQL déterministe, selon la section 6.3
- [ ] Saisie du prix d'adjudication après la vente
- [ ] Lot acheté transformé en bouteilles en cave avec prix payé et état

### Lot 4 (V2) — Sources automatiques

- [ ] Alertes Interenchères transférées et transformées en demandes
- [ ] Import du JSON Leboncoin validé, erreurs lisibles
- [ ] Digest du dimanche par mail

### Lot 5 (V2) — Calibrage et statistiques

- [ ] Écart moyen entre prix conseillé et prix adjugé
- [ ] Statistiques : couleurs, régions, millésimes, consommation, années en manque
- [ ] Export CSV et JSON, sauvegarde hebdomadaire

## 11. Prompts prêts à coller

Les prompts de la tâche Claude planifiée (11.2) sont repris et précisés (SQL, rôle, colonnes) dans
[claude/TACHE_PLANIFIEE.md](claude/TACHE_PLANIFIEE.md).

### 11.3 Veille Leboncoin dans Claude dans Chrome (V2)

```text
Ouvre leboncoin.fr et cherche des annonces de vin à vendre (bouteilles ou caves de particuliers) à moins de 60 km de Lyon, publiées depuis 14 jours. Parcours les annonces comme le ferait une personne, sans ouvrir plus de 30 annonces.

Garde seulement celles dont le prix total est entre 300 et 1 000 €, qui détaillent au moins le domaine ou l'appellation et le millésime, et dont les vins sont à boire dans les 10 ans.

Pour chaque annonce retenue, relève : l'URL, le titre, le prix, la ville, la liste des vins (domaine, appellation, millésime, quantité), ce que dit le vendeur sur la conservation, et les URL des photos.

Rends uniquement un bloc JSON au format de la section 6.4, sans commentaire autour.
```

## 12. Points à trancher

- [ ] **Essai de faisabilité** (Lot 0) : la tâche Claude planifiée doit pouvoir lire, écrire et ouvrir les photos via le connecteur Supabase. Sinon, revoir l'architecture IA.
- [ ] **Limites d'usage** : vérifier que deux passages par jour tiennent dans les limites de ton abonnement Claude, surtout les jours d'import de grosses ventes.
- [ ] **Armoire** : nombre de clayettes et capacité de chacune (à saisir au Lot 1).
- [ ] **Frais acheteur** : taux par défaut à retenir, à vérifier sur tes dernières ventes Interenchères.
- [ ] **Réception des alertes (V2)** : choisir le service qui reçoit les mails transférés (Postmark, Cloudflare Email Routing ou équivalent) et vérifier sur un vrai mail que le descriptif des lots y figure.
- [ ] **Comptes à créer** : Supabase et Vercel ; nom définitif de l'app (« Cellier » est un nom de travail).
