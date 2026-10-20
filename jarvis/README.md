# J.A.R.V.I.S. pour téléphone

Assistant vocal façon Iron Man, installable sur Android et iPhone (PWA). Sans dépendance.

- Voix : reconnaissance + synthèse du navigateur, mot d'activation « Jarvis » (modifiable)
- Compétences locales : heure, date, batterie, minuteur, calcul, météo, itinéraire, recherche, YouTube, appel, lampe torche, blagues
- Cerveau : Claude (conversation libre) via `server.js`, la clé API reste sur le serveur

## Lancer

```sh
cd jarvis
ANTHROPIC_API_KEY=sk-ant-... JARVIS_TOKEN=un-secret node server.js
```

Sans clé, seules les compétences locales fonctionnent.

## Sur le téléphone

Le micro exige **HTTPS** (sauf `localhost`). Exposez le serveur par un tunnel ou un hébergement :

```sh
cloudflared tunnel --url http://localhost:8787   # ou ngrok http 8787
```

Ouvrez l'URL HTTPS dans Chrome (Android) ou Safari (iPhone), puis « Ajouter à l'écran d'accueil ».
Dans ⚙ : saisissez le jeton, activez l'écoute permanente si voulu.

## Limites (honnêtes)

- Une page web ne peut écouter qu'écran allumé et appli ouverte : pas de « Hey Jarvis » téléphone verrouillé.
- Pas d'accès aux SMS, notifications ou autres applis ; Jarvis ouvre des liens (Maps, YouTube, WhatsApp, `tel:`).
- La lampe torche ne marche que sur certains Chrome Android. La reconnaissance vocale dépend de Chrome/Safari.
- Pour aller plus loin (hors appli, wake word natif, contrôle du système), il faudrait une appli native Android.
