# RD Reponses Backend

Backend REST API pour l'app de collecte de réponses intimes.

## Stack

- Node.js + Express + TypeScript
- PostgreSQL (Aiven Cloud)
- Rate limiting (300 req/15min)

## Setup Local

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer .env
cp .env.example .env
# Renseigner DATABASE_URL

# 3. Lancer les migrations
npm run migrate

# 4. Démarrer en dev
npm run dev
```

## Déploiement sur Render

### Option 1 : Depuis le dashboard Render

1. Créer un nouveau **Web Service**
2. Connecter votre repo GitHub
3. Configuration :
   - **Build Command** : `npm install && npm run build`
   - **Start Command** : `npm run start`
   - **Environment** : Node 18+
4. Ajouter les variables d'environnement :
   - `DATABASE_URL` : URL PostgreSQL fournie par Render
   - `DATABASE_SSL` : `true`
   - `NODE_ENV` : `production`
5. Créer une base PostgreSQL sur Render
6. Après le premier déploiement, lancer les migrations :
   ```bash
   # Dans le shell Render
   node run-migrations.js
   ```

### Option 2 : Avec render.yaml (Infrastructure as Code)

Le fichier `render.yaml` est déjà configuré. Il suffit de :

1. Push le code sur GitHub
2. Render détecte automatiquement le `render.yaml`
3. Créera automatiquement :
   - Le service web
   - La base PostgreSQL
   - Liera les deux

**⚠️ Important** : Après le premier déploiement, exécuter les migrations manuellement via le shell Render :
```bash
node run-migrations.js
```

## Migrations

Les migrations se trouvent dans `migrations/` :
- `001_init.sql` - Schema initial (obsolète, remplacé par database.sql)
- `002_sync_questions.sql` - 100 questions intimes synchronisées avec frontend
- `003_unique_answers.sql` - Contrainte unique pour éviter doublons

Pour appliquer toutes les migrations :
```bash
npm run migrate  # Local (dev)
node run-migrations.js  # Production (Render shell)
```

## API Endpoints

| Route | Méthode | Description |
|-------|---------|-------------|
| `/health` | GET | Health check |
| `/sessions` | POST | Créer/update session |
| `/sessions/:id` | GET | Récupérer session |
| `/progress?session_id=` | GET | Progression session |
| `/answers` | POST | Soumettre réponse |
| `/recap?session_id=` | GET | Toutes les réponses |
| `/admin/users` | GET | Liste utilisateurs |
| `/admin/users/:id/questions` | GET | Questions d'un user |
| `/admin/pairings` | POST | Créer un duo |

## Sécurité

- ✅ Rate limiting activé
- ✅ CORS configuré
- ✅ Validation stricte des inputs
- ✅ Transactions SQL
- ✅ SSL/TLS en production
- ⚠️ **TODO** : Ajouter authentification JWT

## Troubleshooting

**Erreur SSL en dev** :
```bash
# Utiliser NODE_TLS_REJECT_UNAUTHORIZED=0 (déjà configuré dans npm run dev)
```

**Migrations ne s'appliquent pas** :
```bash
# Vérifier DATABASE_URL
echo $DATABASE_URL

# Lancer manuellement
node run-migrations.js
```

**Port déjà utilisé** :
```bash
# Changer PORT dans .env
PORT=3002 npm run dev
```
