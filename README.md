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
- `001_init.sql` - Schema initial avec 100 questions
- `002_sync_questions.sql` - 100 questions intimes synchronisées avec frontend
- `003_unique_answers.sql` - Contrainte unique pour éviter doublons
- `004_add_auth.sql` - Colonnes email et password_hash pour authentification

Pour appliquer toutes les migrations :
```bash
npm run migrate  # Local (dev)
node run-migrations.js  # Production (Render shell)
```

## API Endpoints

| Route | Méthode | Auth | Description |
|-------|---------|------|-------------|
| `/health` | GET | - | Health check |
| `/auth/register` | POST | - | Créer un compte |
| `/auth/login` | POST | - | Se connecter |
| `/sessions` | POST | Optional | Créer/update session |
| `/sessions/:id` | GET | Optional | Récupérer session |
| `/progress?session_id=` | GET | Optional | Progression session |
| `/answers` | POST | Optional | Soumettre réponse |
| `/answers/batch` | POST | Optional | Soumettre jusqu'à 100 réponses |
| `/recap?session_id=` | GET | Optional | Toutes les réponses |
| `/admin/users` | GET | Required | Liste utilisateurs (paginée) |
| `/admin/users/:id/questions` | GET | Required | Questions d'un user |
| `/admin/pairings` | POST | Required | Créer un duo |

## Sécurité

- ✅ Rate limiting activé (300 req/15min global, 10 req/15min auth)
- ✅ CORS configuré avec whitelist stricte
- ✅ Validation stricte des inputs
- ✅ Transactions SQL
- ✅ SSL/TLS en production
- ✅ Authentification JWT avec bcrypt
- ✅ HTTPS enforcement
- ✅ Security headers (HSTS, CSP, X-Frame-Options)
- ✅ Authorization checks (users can only access their own data)

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
