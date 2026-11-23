import type { Locale } from '@lambdaorm/ui'

/** The texts of the app (the components bring their own); the example query and the names (REST, MCP…) stay as they are */
export interface Texts {
	/** an asset of the page is not in the gateway any more: it was updated while the page was open */
	preferences: string
	accountAuthentication: string
	permissions: string
	close: string
	headerName: string
	culture: string
	cultureNote: string
	documentation: string
	connection: string
	current: string
	notConnected: string
	connectedAs: string
	unreachable: string
	connectionName: string
	protocol: string
	address: string
	rememberKey: string
	connectionNote: string
	confirmRemove: string
	removeConnection: string
	test: string
	saveConnection: string
	addConnection: string
	newConnection: string
	needsKey: string
	menu: string
	cancel: string
	connections: string
	editConnection: string
	tools: string
	openSwagger: string
	openWebSocket: string
	openMcp: string
	notExposed: string
	schema: string
	connected: string
	closed: string
	connect: string
	disconnect: string
	reconnect: string
	methods: string
	request: string
	send: string
	messages: string
	mcpTools: string
	arguments: string
	call: string
	result: string
	pickTool: string
	publicUrls: string
	publicUrlsNote: string
	restUrl: string
	webSocketUrl: string
	mcpUrl: string
	updated: string
	reload: string
	theme: string
	themeSystem: string
	themeLight: string
	themeDark: string
	language: string
	loading: string
	remember: string
	authentication: string
	apikey: string
	bearer: string
	basic: string
	none: string
	header: string
	user: string
	password: string
	key: string
	token: string
	checking: string
	show: string
	hide: string
	invalid: string
	sessions: string
	mySessions: string
	activeSessions: string
	thisSession: string
	lastActivity: string
	endsAt: string
	closeSession: string
	closeOthers: string
	revokeSession: string
	revokeAll: string
	confirmRevokeAll: string
	lookingAt: string
	noOtherSessions: string
	sessionEnded: string
	sessionExpiring: string
	sessionsNote: string
}

const en: Texts = {
	preferences: 'Preferences', accountAuthentication: 'Authentication', permissions: 'Permissions', close: 'Close', headerName: 'header', culture: 'Regional format', cultureNote: 'numbers and dates of the results (tree and table)', documentation: 'Documentation', connection: 'Connection', current: 'current', notConnected: 'not connected', connectedAs: 'Connected as {name}', unreachable: 'The IDE server can’t reach the data-gateway (its URL, or its management port is not exposed).', connectionName: 'Name', protocol: 'Protocol', address: 'Management address (host:port/base path)', rememberKey: 'Remember the key in this browser', connectionNote: 'The connection stays in this browser; the schemas, workspaces and projects are in the data-gateway.', confirmRemove: 'Remove this connection from the IDE? (nothing is removed from the data-gateway)', removeConnection: 'Remove', test: 'Test', saveConnection: 'Save', addConnection: 'Connect', newConnection: 'New connection', needsKey: 'Its key: open the connection to enter it', menu: 'Menu', cancel: 'Cancel', connections: 'Connections', editConnection: 'Edit the connection', tools: 'Tools', openSwagger: 'REST API (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'not exposed by this data-gateway', schema: 'Schema', connected: 'connected', closed: 'closed', connect: 'Connect', disconnect: 'Disconnect', reconnect: 'Connect again', methods: 'Methods', request: 'Request', send: 'Send', messages: 'Messages', mcpTools: 'Tools of the schema', arguments: 'Arguments', call: 'Call', result: 'Result', pickTool: 'Choose a tool', publicUrls: 'Other URLs of its transports', publicUrlsNote: 'Only when the IDE server doesn’t reach its REST, WebSocket or MCP at the ports the gateway tells (a proxy in front, another network): their URL here.', restUrl: 'REST URL', webSocketUrl: 'WebSocket URL', mcpUrl: 'MCP URL', updated: 'A new version of the UI is in the gateway: reload to use it (what is saved stays).', reload: 'Reload', theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark', language: 'Language',
	loading: 'Loading…', remember: 'Remember me in this browser',
	authentication: 'Authentication', apikey: 'API key', bearer: 'Bearer token', basic: 'Basic (user and password)', none: 'None',
	header: 'Header', user: 'User', password: 'Password', key: 'Key', token: 'Token', checking: 'Checking…', show: 'Show', hide: 'Hide',
	invalid: 'The credential is not valid.',
	sessions: 'Sessions', mySessions: 'My sessions', activeSessions: 'Active sessions', thisSession: 'this one', lastActivity: 'last activity', endsAt: 'ends', closeSession: 'Close', closeOthers: 'Close the others', revokeSession: 'Revoke', revokeAll: 'Revoke all', confirmRevokeAll: 'Revoke every session of {name}? Whoever uses them will have to log in again.', lookingAt: 'looking at', noOtherSessions: 'No other session of this credential.', sessionEnded: 'The session ended: {reason}', sessionExpiring: 'The session ends in 2 minutes: save what you are editing.', sessionsNote: 'The IDE works with a session of the gateway, opened with this credential; it ends after a while without activity.'
}

const TEXTS: Record<Locale, Texts> = {
	en,
	es: {
		preferences: 'Preferencias', accountAuthentication: 'Autenticación', permissions: 'Permisos', close: 'Cerrar', headerName: 'cabecera', culture: 'Formato regional', cultureNote: 'números y fechas de los resultados (árbol y tabla)', documentation: 'Documentación', connection: 'Conexión', current: 'actual', notConnected: 'sin conectar', connectedAs: 'Conectado como {name}', unreachable: 'El servidor del IDE no llega a la data-gateway (su URL, o no expone su puerto de management).', connectionName: 'Nombre', protocol: 'Protocolo', address: 'Dirección del management (host:puerto/ruta base)', rememberKey: 'Recordar la clave en este navegador', connectionNote: 'La conexión queda en este navegador; los esquemas, workspaces y proyectos están en la data-gateway.', confirmRemove: '¿Quitar esta conexión del IDE? (no se borra nada de la data-gateway)', removeConnection: 'Quitar', test: 'Probar', saveConnection: 'Guardar', addConnection: 'Conectar', newConnection: 'Nueva conexión', needsKey: 'Falta su clave: abrí la conexión para ingresarla', menu: 'Menú', cancel: 'Cancelar', connections: 'Conexiones', editConnection: 'Editar la conexión', tools: 'Herramientas', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'esta data-gateway no lo expone', schema: 'Esquema', connected: 'conectado', closed: 'cerrado', connect: 'Conectar', disconnect: 'Desconectar', reconnect: 'Reconectar', methods: 'Métodos', request: 'Pedido', send: 'Enviar', messages: 'Mensajes', mcpTools: 'Tools del esquema', arguments: 'Argumentos', call: 'Llamar', result: 'Resultado', pickTool: 'Elegí una tool', publicUrls: 'Otras URLs de sus transportes', publicUrlsNote: 'Solo si el servidor del IDE no alcanza su REST, WebSocket o MCP en los puertos que la gateway dice (un proxy adelante, otra red): su URL acá.', restUrl: 'URL de REST', webSocketUrl: 'URL del WebSocket', mcpUrl: 'URL del MCP', updated: 'Hay una versión nueva de la UI en la gateway: recargá para usarla (lo guardado se mantiene).', reload: 'Recargar', theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Oscuro', language: 'Idioma',
		loading: 'Cargando…', remember: 'Recordarme en este navegador',
		authentication: 'Autenticación', apikey: 'API key', bearer: 'Token Bearer', basic: 'Basic (usuario y contraseña)', none: 'Ninguna',
		header: 'Header', user: 'Usuario', password: 'Contraseña', key: 'Clave', token: 'Token', checking: 'Verificando…', show: 'Mostrar', hide: 'Ocultar',
		invalid: 'La credencial no es válida.',
		sessions: 'Sesiones', mySessions: 'Mis sesiones', activeSessions: 'Sesiones activas', thisSession: 'esta', lastActivity: 'última actividad', endsAt: 'vence', closeSession: 'Cerrar', closeOthers: 'Cerrar las otras', revokeSession: 'Revocar', revokeAll: 'Revocar todas', confirmRevokeAll: '¿Revocar todas las sesiones de {name}? Quien las use tendrá que volver a ingresar.', lookingAt: 'mirando', noOtherSessions: 'No hay otras sesiones de esta credencial.', sessionEnded: 'La sesión terminó: {reason}', sessionExpiring: 'La sesión vence en 2 minutos: guardá lo que estés editando.', sessionsNote: 'El IDE trabaja con una sesión de la gateway, abierta con esta credencial; vence tras un rato sin actividad.'
	},
	pt: {
		preferences: 'Preferências', accountAuthentication: 'Autenticação', permissions: 'Permissões', close: 'Fechar', headerName: 'cabeçalho', culture: 'Formato regional', cultureNote: 'números e datas dos resultados (árvore e tabela)', documentation: 'Documentação', connection: 'Conexão', current: 'atual', notConnected: 'não conectada', connectedAs: 'Conectado como {name}', unreachable: 'O servidor do IDE não chega à data-gateway (sua URL, ou ela não expõe a porta de management).', connectionName: 'Nome', protocol: 'Protocolo', address: 'Endereço do management (host:porta/caminho base)', rememberKey: 'Lembrar a chave neste navegador', connectionNote: 'A conexão fica neste navegador; os esquemas, workspaces e projetos estão na data-gateway.', confirmRemove: 'Remover esta conexão do IDE? (nada é removido da data-gateway)', removeConnection: 'Remover', test: 'Testar', saveConnection: 'Salvar', addConnection: 'Conectar', newConnection: 'Nova conexão', needsKey: 'Falta a chave: abra a conexão para informá-la', menu: 'Menu', cancel: 'Cancelar', connections: 'Conexões', editConnection: 'Editar a conexão', tools: 'Ferramentas', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'esta data-gateway não o expõe', schema: 'Esquema', connected: 'conectado', closed: 'fechado', connect: 'Conectar', disconnect: 'Desconectar', reconnect: 'Reconectar', methods: 'Métodos', request: 'Requisição', send: 'Enviar', messages: 'Mensagens', mcpTools: 'Tools do esquema', arguments: 'Argumentos', call: 'Chamar', result: 'Resultado', pickTool: 'Escolha uma tool', publicUrls: 'Outras URLs dos seus transportes', publicUrlsNote: 'Só se o servidor do IDE não alcançar o REST, WebSocket ou MCP nas portas que a gateway informa (um proxy na frente, outra rede): a URL aqui.', restUrl: 'URL do REST', webSocketUrl: 'URL do WebSocket', mcpUrl: 'URL do MCP', updated: 'Há uma versão nova da UI na gateway: recarregue para usá-la (o que está salvo permanece).', reload: 'Recarregar', theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Escuro', language: 'Idioma',
		loading: 'Carregando…', remember: 'Lembrar-me neste navegador',
		authentication: 'Autenticação', apikey: 'API key', bearer: 'Token Bearer', basic: 'Basic (usuário e senha)', none: 'Nenhuma',
		header: 'Header', user: 'Usuário', password: 'Senha', key: 'Chave', token: 'Token', checking: 'Verificando…', show: 'Mostrar', hide: 'Ocultar',
		invalid: 'A credencial não é válida.',
		sessions: 'Sessões', mySessions: 'Minhas sessões', activeSessions: 'Sessões ativas', thisSession: 'esta', lastActivity: 'última atividade', endsAt: 'expira', closeSession: 'Fechar', closeOthers: 'Fechar as outras', revokeSession: 'Revogar', revokeAll: 'Revogar todas', confirmRevokeAll: 'Revogar todas as sessões de {name}? Quem as usa terá de entrar de novo.', lookingAt: 'olhando', noOtherSessions: 'Nenhuma outra sessão desta credencial.', sessionEnded: 'A sessão terminou: {reason}', sessionExpiring: 'A sessão expira em 2 minutos: salve o que estiver editando.', sessionsNote: 'A IDE trabalha com uma sessão do gateway, aberta com esta credencial; ela expira após um tempo sem atividade.'
	},
	fr: {
		preferences: 'Préférences', accountAuthentication: 'Authentification', permissions: 'Permissions', close: 'Fermer', headerName: 'en-tête', culture: 'Format régional', cultureNote: 'nombres et dates des résultats (arbre et tableau)', documentation: 'Documentation', connection: 'Connexion', current: 'actuelle', notConnected: 'non connectée', connectedAs: 'Connecté en tant que {name}', unreachable: 'Le serveur de l’IDE ne joint pas la data-gateway (son URL, ou elle n’expose pas son port de management).', connectionName: 'Nom', protocol: 'Protocole', address: 'Adresse du management (hôte:port/chemin de base)', rememberKey: 'Retenir la clé dans ce navigateur', connectionNote: 'La connexion reste dans ce navigateur ; les schémas, workspaces et projets sont dans la data-gateway.', confirmRemove: 'Retirer cette connexion de l’IDE ? (rien n’est supprimé de la data-gateway)', removeConnection: 'Retirer', test: 'Tester', saveConnection: 'Enregistrer', addConnection: 'Connecter', newConnection: 'Nouvelle connexion', needsKey: 'Sa clé manque : ouvrez la connexion pour la saisir', menu: 'Menu', cancel: 'Annuler', connections: 'Connexions', editConnection: 'Modifier la connexion', tools: 'Outils', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'non exposé par cette data-gateway', schema: 'Schéma', connected: 'connecté', closed: 'fermé', connect: 'Connecter', disconnect: 'Déconnecter', reconnect: 'Reconnecter', methods: 'Méthodes', request: 'Requête', send: 'Envoyer', messages: 'Messages', mcpTools: 'Outils du schéma', arguments: 'Arguments', call: 'Appeler', result: 'Résultat', pickTool: 'Choisissez un outil', publicUrls: 'Autres URL de ses transports', publicUrlsNote: 'Seulement si le serveur de l’IDE ne joint pas son REST, WebSocket ou MCP aux ports indiqués par la gateway (un proxy devant, un autre réseau) : leur URL ici.', restUrl: 'URL REST', webSocketUrl: 'URL du WebSocket', mcpUrl: 'URL du MCP', updated: 'Une nouvelle version de l’UI est dans la gateway : rechargez pour l’utiliser (ce qui est enregistré reste).', reload: 'Recharger', theme: 'Thème', themeSystem: 'Système', themeLight: 'Clair', themeDark: 'Sombre', language: 'Langue',
		loading: 'Chargement…', remember: 'Se souvenir de moi dans ce navigateur',
		authentication: 'Authentification', apikey: 'Clé d’API', bearer: 'Jeton Bearer', basic: 'Basic (utilisateur et mot de passe)', none: 'Aucune',
		header: 'En-tête', user: 'Utilisateur', password: 'Mot de passe', key: 'Clé', token: 'Jeton', checking: 'Vérification…', show: 'Afficher', hide: 'Masquer',
		invalid: 'L’identifiant n’est pas valide.',
		sessions: 'Sessions', mySessions: 'Mes sessions', activeSessions: 'Sessions actives', thisSession: 'celle-ci', lastActivity: 'dernière activité', endsAt: 'expire', closeSession: 'Fermer', closeOthers: 'Fermer les autres', revokeSession: 'Révoquer', revokeAll: 'Tout révoquer', confirmRevokeAll: 'Révoquer toutes les sessions de {name} ? Ceux qui les utilisent devront se reconnecter.', lookingAt: 'regarde', noOtherSessions: 'Aucune autre session de cet identifiant.', sessionEnded: 'La session est terminée : {reason}', sessionExpiring: 'La session expire dans 2 minutes : enregistrez ce que vous modifiez.', sessionsNote: 'L’IDE travaille avec une session de la gateway, ouverte avec cet identifiant ; elle expire après un moment sans activité.'
	},
	it: {
		preferences: 'Preferenze', accountAuthentication: 'Autenticazione', permissions: 'Permessi', close: 'Chiudi', headerName: 'intestazione', culture: 'Formato regionale', cultureNote: 'numeri e date dei risultati (albero e tabella)', documentation: 'Documentazione', connection: 'Connessione', current: 'attuale', notConnected: 'non connessa', connectedAs: 'Connesso come {name}', unreachable: 'Il server dell’IDE non raggiunge la data-gateway (il suo URL, o non espone la porta di management).', connectionName: 'Nome', protocol: 'Protocollo', address: 'Indirizzo del management (host:porta/percorso base)', rememberKey: 'Ricorda la chiave in questo browser', connectionNote: 'La connessione resta in questo browser; schemi, workspace e progetti sono nella data-gateway.', confirmRemove: 'Rimuovere questa connessione dall’IDE? (nulla viene eliminato dalla data-gateway)', removeConnection: 'Rimuovi', test: 'Prova', saveConnection: 'Salva', addConnection: 'Connetti', newConnection: 'Nuova connessione', needsKey: 'Manca la chiave: apri la connessione per inserirla', menu: 'Menu', cancel: 'Annulla', connections: 'Connessioni', editConnection: 'Modifica la connessione', tools: 'Strumenti', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'non esposto da questa data-gateway', schema: 'Schema', connected: 'connesso', closed: 'chiuso', connect: 'Connetti', disconnect: 'Disconnetti', reconnect: 'Riconnetti', methods: 'Metodi', request: 'Richiesta', send: 'Invia', messages: 'Messaggi', mcpTools: 'Tool dello schema', arguments: 'Argomenti', call: 'Chiama', result: 'Risultato', pickTool: 'Scegli un tool', publicUrls: 'Altri URL dei suoi trasporti', publicUrlsNote: 'Solo se il server dell’IDE non raggiunge il suo REST, WebSocket o MCP alle porte che dice il gateway (un proxy davanti, un’altra rete): il loro URL qui.', restUrl: 'URL REST', webSocketUrl: 'URL del WebSocket', mcpUrl: 'URL del MCP', updated: 'C’è una nuova versione della UI nel gateway: ricarica per usarla (ciò che è salvato resta).', reload: 'Ricarica', theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Chiaro', themeDark: 'Scuro', language: 'Lingua',
		loading: 'Caricamento…', remember: 'Ricordami in questo browser',
		authentication: 'Autenticazione', apikey: 'Chiave API', bearer: 'Token Bearer', basic: 'Basic (utente e password)', none: 'Nessuna',
		header: 'Header', user: 'Utente', password: 'Password', key: 'Chiave', token: 'Token', checking: 'Verifica…', show: 'Mostra', hide: 'Nascondi',
		invalid: 'La credenziale non è valida.',
		sessions: 'Sessioni', mySessions: 'Le mie sessioni', activeSessions: 'Sessioni attive', thisSession: 'questa', lastActivity: 'ultima attività', endsAt: 'scade', closeSession: 'Chiudi', closeOthers: 'Chiudi le altre', revokeSession: 'Revoca', revokeAll: 'Revoca tutte', confirmRevokeAll: 'Revocare tutte le sessioni di {name}? Chi le usa dovrà accedere di nuovo.', lookingAt: 'sta guardando', noOtherSessions: 'Nessun’altra sessione di questa credenziale.', sessionEnded: 'La sessione è terminata: {reason}', sessionExpiring: 'La sessione scade tra 2 minuti: salva ciò che stai modificando.', sessionsNote: 'L’IDE lavora con una sessione del gateway, aperta con questa credenziale; scade dopo un po’ senza attività.'
	},
	de: {
		preferences: 'Einstellungen', accountAuthentication: 'Authentifizierung', permissions: 'Berechtigungen', close: 'Schließen', headerName: 'Header', culture: 'Regionales Format', cultureNote: 'Zahlen und Daten der Ergebnisse (Baum und Tabelle)', documentation: 'Dokumentation', connection: 'Verbindung', current: 'aktuell', notConnected: 'nicht verbunden', connectedAs: 'Verbunden als {name}', unreachable: 'Der IDE-Server erreicht das data-gateway nicht (seine URL, oder sein Management-Port ist nicht offen).', connectionName: 'Name', protocol: 'Protokoll', address: 'Management-Adresse (Host:Port/Basispfad)', rememberKey: 'Schlüssel in diesem Browser merken', connectionNote: 'Die Verbindung bleibt in diesem Browser; Schemas, Workspaces und Projekte liegen im data-gateway.', confirmRemove: 'Diese Verbindung aus der IDE entfernen? (im data-gateway wird nichts gelöscht)', removeConnection: 'Entfernen', test: 'Testen', saveConnection: 'Speichern', addConnection: 'Verbinden', newConnection: 'Neue Verbindung', needsKey: 'Schlüssel fehlt: Verbindung öffnen, um ihn einzugeben', menu: 'Menü', cancel: 'Abbrechen', connections: 'Verbindungen', editConnection: 'Verbindung bearbeiten', tools: 'Werkzeuge', openSwagger: 'REST-API (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'von diesem data-gateway nicht angeboten', schema: 'Schema', connected: 'verbunden', closed: 'geschlossen', connect: 'Verbinden', disconnect: 'Trennen', reconnect: 'Erneut verbinden', methods: 'Methoden', request: 'Anfrage', send: 'Senden', messages: 'Nachrichten', mcpTools: 'Tools des Schemas', arguments: 'Argumente', call: 'Aufrufen', result: 'Ergebnis', pickTool: 'Wähle ein Tool', publicUrls: 'Andere URLs seiner Transporte', publicUrlsNote: 'Nur wenn der IDE-Server REST, WebSocket oder MCP nicht an den Ports erreicht, die das Gateway nennt (ein Proxy davor, ein anderes Netz): ihre URL hier.', restUrl: 'REST-URL', webSocketUrl: 'WebSocket-URL', mcpUrl: 'MCP-URL', updated: 'Im Gateway gibt es eine neue Version der UI: neu laden, um sie zu verwenden (Gespeichertes bleibt).', reload: 'Neu laden', theme: 'Design', themeSystem: 'System', themeLight: 'Hell', themeDark: 'Dunkel', language: 'Sprache',
		loading: 'Wird geladen…', remember: 'In diesem Browser angemeldet bleiben',
		authentication: 'Authentifizierung', apikey: 'API-Schlüssel', bearer: 'Bearer-Token', basic: 'Basic (Benutzer und Passwort)', none: 'Keine',
		header: 'Header', user: 'Benutzer', password: 'Passwort', key: 'Schlüssel', token: 'Token', checking: 'Wird geprüft…', show: 'Anzeigen', hide: 'Verbergen',
		invalid: 'Die Anmeldedaten sind nicht gültig.',
		sessions: 'Sitzungen', mySessions: 'Meine Sitzungen', activeSessions: 'Aktive Sitzungen', thisSession: 'diese', lastActivity: 'letzte Aktivität', endsAt: 'läuft ab', closeSession: 'Schließen', closeOthers: 'Die anderen schließen', revokeSession: 'Widerrufen', revokeAll: 'Alle widerrufen', confirmRevokeAll: 'Alle Sitzungen von {name} widerrufen? Wer sie nutzt, muss sich erneut anmelden.', lookingAt: 'sieht', noOtherSessions: 'Keine weitere Sitzung dieser Anmeldedaten.', sessionEnded: 'Die Sitzung ist beendet: {reason}', sessionExpiring: 'Die Sitzung läuft in 2 Minuten ab: speichere, was du bearbeitest.', sessionsNote: 'Die IDE arbeitet mit einer Sitzung des Gateways, geöffnet mit diesen Anmeldedaten; sie läuft nach einer Weile ohne Aktivität ab.'
	},
	nl: {
		preferences: 'Voorkeuren', accountAuthentication: 'Authenticatie', permissions: 'Rechten', close: 'Sluiten', headerName: 'header', culture: 'Regionale notatie', cultureNote: 'getallen en datums van de resultaten (boom en tabel)', documentation: 'Documentatie', connection: 'Verbinding', current: 'huidige', notConnected: 'niet verbonden', connectedAs: 'Verbonden als {name}', unreachable: 'De IDE-server bereikt de data-gateway niet (de URL, of de managementpoort is niet open).', connectionName: 'Naam', protocol: 'Protocol', address: 'Adres van management (host:poort/basispad)', rememberKey: 'Sleutel onthouden in deze browser', connectionNote: 'De verbinding blijft in deze browser; schema’s, workspaces en projecten staan in de data-gateway.', confirmRemove: 'Deze verbinding uit de IDE verwijderen? (er wordt niets uit de data-gateway verwijderd)', removeConnection: 'Verwijderen', test: 'Testen', saveConnection: 'Opslaan', addConnection: 'Verbinden', newConnection: 'Nieuwe verbinding', needsKey: 'Sleutel ontbreekt: open de verbinding om hem in te voeren', menu: 'Menu', cancel: 'Annuleren', connections: 'Verbindingen', editConnection: 'Verbinding bewerken', tools: 'Hulpmiddelen', openSwagger: 'REST-API (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'niet aangeboden door deze data-gateway', schema: 'Schema', connected: 'verbonden', closed: 'gesloten', connect: 'Verbinden', disconnect: 'Verbreken', reconnect: 'Opnieuw verbinden', methods: 'Methoden', request: 'Verzoek', send: 'Verzenden', messages: 'Berichten', mcpTools: 'Tools van het schema', arguments: 'Argumenten', call: 'Aanroepen', result: 'Resultaat', pickTool: 'Kies een tool', publicUrls: 'Andere URL’s van de transports', publicUrlsNote: 'Alleen als de IDE-server REST, WebSocket of MCP niet bereikt op de poorten die de gateway noemt (een proxy ervoor, een ander netwerk): hun URL hier.', restUrl: 'REST-URL', webSocketUrl: 'WebSocket-URL', mcpUrl: 'MCP-URL', updated: 'Er staat een nieuwe versie van de UI in de gateway: herlaad om die te gebruiken (wat opgeslagen is blijft).', reload: 'Herladen', theme: 'Thema', themeSystem: 'Systeem', themeLight: 'Licht', themeDark: 'Donker', language: 'Taal',
		loading: 'Laden…', remember: 'Onthoud mij in deze browser',
		authentication: 'Authenticatie', apikey: 'API-sleutel', bearer: 'Bearer-token', basic: 'Basic (gebruiker en wachtwoord)', none: 'Geen',
		header: 'Header', user: 'Gebruiker', password: 'Wachtwoord', key: 'Sleutel', token: 'Token', checking: 'Controleren…', show: 'Tonen', hide: 'Verbergen',
		invalid: 'De inloggegevens zijn niet geldig.',
		sessions: 'Sessies', mySessions: 'Mijn sessies', activeSessions: 'Actieve sessies', thisSession: 'deze', lastActivity: 'laatste activiteit', endsAt: 'verloopt', closeSession: 'Sluiten', closeOthers: 'De andere sluiten', revokeSession: 'Intrekken', revokeAll: 'Alles intrekken', confirmRevokeAll: 'Alle sessies van {name} intrekken? Wie ze gebruikt, moet opnieuw inloggen.', lookingAt: 'bekijkt', noOtherSessions: 'Geen andere sessie van deze inloggegevens.', sessionEnded: 'De sessie is beëindigd: {reason}', sessionExpiring: 'De sessie verloopt over 2 minuten: sla op wat je bewerkt.', sessionsNote: 'De IDE werkt met een sessie van de gateway, geopend met deze inloggegevens; die verloopt na een tijdje zonder activiteit.'
	},
	ca: {
		preferences: 'Preferències', accountAuthentication: 'Autenticació', permissions: 'Permisos', close: 'Tanca', headerName: 'capçalera', culture: 'Format regional', cultureNote: 'números i dates dels resultats (arbre i taula)', documentation: 'Documentació', connection: 'Connexió', current: 'actual', notConnected: 'sense connectar', connectedAs: 'Connectat com a {name}', unreachable: 'El servidor de l’IDE no arriba a la data-gateway (la seva URL, o no exposa el port de management).', connectionName: 'Nom', protocol: 'Protocol', address: 'Adreça del management (host:port/camí base)', rememberKey: 'Recorda la clau en aquest navegador', connectionNote: 'La connexió queda en aquest navegador; els esquemes, workspaces i projectes són a la data-gateway.', confirmRemove: 'Treure aquesta connexió de l’IDE? (no s’esborra res de la data-gateway)', removeConnection: 'Treu', test: 'Prova', saveConnection: 'Desa', addConnection: 'Connecta', newConnection: 'Connexió nova', needsKey: 'Falta la clau: obre la connexió per introduir-la', menu: 'Menú', cancel: 'Cancel·la', connections: 'Connexions', editConnection: 'Edita la connexió', tools: 'Eines', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'aquesta data-gateway no l’exposa', schema: 'Esquema', connected: 'connectat', closed: 'tancat', connect: 'Connecta', disconnect: 'Desconnecta', reconnect: 'Reconnecta', methods: 'Mètodes', request: 'Petició', send: 'Envia', messages: 'Missatges', mcpTools: 'Tools de l’esquema', arguments: 'Arguments', call: 'Crida', result: 'Resultat', pickTool: 'Tria una tool', publicUrls: 'Altres URLs dels seus transports', publicUrlsNote: 'Només si el servidor de l’IDE no assoleix el REST, WebSocket o MCP als ports que diu la gateway (un proxy davant, una altra xarxa): la seva URL aquí.', restUrl: 'URL de REST', webSocketUrl: 'URL del WebSocket', mcpUrl: 'URL del MCP', updated: 'Hi ha una versió nova de la UI a la gateway: recarrega per fer-la servir (el que està desat es manté).', reload: 'Recarrega', theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Clar', themeDark: 'Fosc', language: 'Idioma',
		loading: 'S’està carregant…', remember: 'Recorda’m en aquest navegador',
		authentication: 'Autenticació', apikey: 'Clau d’API', bearer: 'Token Bearer', basic: 'Basic (usuari i contrasenya)', none: 'Cap',
		header: 'Capçalera', user: 'Usuari', password: 'Contrasenya', key: 'Clau', token: 'Token', checking: 'S’està comprovant…', show: 'Mostra', hide: 'Amaga',
		invalid: 'La credencial no és vàlida.',
		sessions: 'Sessions', mySessions: 'Les meves sessions', activeSessions: 'Sessions actives', thisSession: 'aquesta', lastActivity: 'última activitat', endsAt: 'caduca', closeSession: 'Tanca', closeOthers: 'Tanca les altres', revokeSession: 'Revoca', revokeAll: 'Revoca-les totes', confirmRevokeAll: 'Revocar totes les sessions de {name}? Qui les faci servir haurà de tornar a entrar.', lookingAt: 'mirant', noOtherSessions: 'No hi ha cap altra sessió d’aquesta credencial.', sessionEnded: 'La sessió ha acabat: {reason}', sessionExpiring: 'La sessió caduca d’aquí a 2 minuts: desa el que estiguis editant.', sessionsNote: 'L’IDE treballa amb una sessió de la gateway, oberta amb aquesta credencial; caduca després d’una estona sense activitat.'
	},
	gl: {
		preferences: 'Preferencias', accountAuthentication: 'Autenticación', permissions: 'Permisos', close: 'Pechar', headerName: 'cabeceira', culture: 'Formato rexional', cultureNote: 'números e datas dos resultados (árbore e táboa)', documentation: 'Documentación', connection: 'Conexión', current: 'actual', notConnected: 'sen conectar', connectedAs: 'Conectado como {name}', unreachable: 'O servidor do IDE non chega á data-gateway (o seu URL, ou non expón o porto de management).', connectionName: 'Nome', protocol: 'Protocolo', address: 'Enderezo do management (host:porto/ruta base)', rememberKey: 'Lembrar a chave neste navegador', connectionNote: 'A conexión queda neste navegador; os esquemas, workspaces e proxectos están na data-gateway.', confirmRemove: 'Quitar esta conexión do IDE? (non se borra nada da data-gateway)', removeConnection: 'Quitar', test: 'Probar', saveConnection: 'Gardar', addConnection: 'Conectar', newConnection: 'Nova conexión', needsKey: 'Falta a chave: abre a conexión para introducila', menu: 'Menú', cancel: 'Cancelar', connections: 'Conexións', editConnection: 'Editar a conexión', tools: 'Ferramentas', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'esta data-gateway non o expón', schema: 'Esquema', connected: 'conectado', closed: 'pechado', connect: 'Conectar', disconnect: 'Desconectar', reconnect: 'Reconectar', methods: 'Métodos', request: 'Petición', send: 'Enviar', messages: 'Mensaxes', mcpTools: 'Tools do esquema', arguments: 'Argumentos', call: 'Chamar', result: 'Resultado', pickTool: 'Escolle unha tool', publicUrls: 'Outros URLs dos seus transportes', publicUrlsNote: 'Só se o servidor do IDE non alcanza o REST, WebSocket ou MCP nos portos que di a gateway (un proxy diante, outra rede): o seu URL aquí.', restUrl: 'URL de REST', webSocketUrl: 'URL do WebSocket', mcpUrl: 'URL do MCP', updated: 'Hai unha versión nova da UI na gateway: recarga para usala (o gardado mantense).', reload: 'Recargar', theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Escuro', language: 'Idioma',
		loading: 'Cargando…', remember: 'Lembrarme neste navegador',
		authentication: 'Autenticación', apikey: 'Chave de API', bearer: 'Token Bearer', basic: 'Basic (usuario e contrasinal)', none: 'Ningunha',
		header: 'Cabeceira', user: 'Usuario', password: 'Contrasinal', key: 'Chave', token: 'Token', checking: 'Comprobando…', show: 'Amosar', hide: 'Agochar',
		invalid: 'A credencial non é válida.',
		sessions: 'Sesións', mySessions: 'As miñas sesións', activeSessions: 'Sesións activas', thisSession: 'esta', lastActivity: 'última actividade', endsAt: 'caduca', closeSession: 'Pechar', closeOthers: 'Pechar as outras', revokeSession: 'Revogar', revokeAll: 'Revogar todas', confirmRevokeAll: 'Revogar todas as sesións de {name}? Quen as use terá que entrar de novo.', lookingAt: 'mirando', noOtherSessions: 'Non hai outras sesións desta credencial.', sessionEnded: 'A sesión rematou: {reason}', sessionExpiring: 'A sesión caduca en 2 minutos: garda o que esteas editando.', sessionsNote: 'O IDE traballa cunha sesión da gateway, aberta con esta credencial; caduca tras un tempo sen actividade.'
	},
	eu: {
		preferences: 'Hobespenak', accountAuthentication: 'Autentifikazioa', permissions: 'Baimenak', close: 'Itxi', headerName: 'goiburua', culture: 'Eskualde-formatua', cultureNote: 'emaitzen zenbakiak eta datak (zuhaitza eta taula)', documentation: 'Dokumentazioa', connection: 'Konexioa', current: 'unekoa', notConnected: 'konektatu gabe', connectedAs: '{name} gisa konektatuta', unreachable: 'IDEaren zerbitzaria ez da data-gatewayra iristen (bere URLa, edo ez du management ataka irekita).', connectionName: 'Izena', protocol: 'Protokoloa', address: 'Managementaren helbidea (host:ataka/oinarrizko bidea)', rememberKey: 'Gogoratu gakoa nabigatzaile honetan', connectionNote: 'Konexioa nabigatzaile honetan geratzen da; eskemak, workspaceak eta proiektuak data-gatewayan daude.', confirmRemove: 'Konexio hau IDEtik kendu? (ez da ezer ezabatzen data-gatewaytik)', removeConnection: 'Kendu', test: 'Probatu', saveConnection: 'Gorde', addConnection: 'Konektatu', newConnection: 'Konexio berria', needsKey: 'Gakoa falta da: ireki konexioa sartzeko', menu: 'Menua', cancel: 'Utzi', connections: 'Konexioak', editConnection: 'Editatu konexioa', tools: 'Tresnak', openSwagger: 'REST APIa (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'data-gateway honek ez du eskaintzen', schema: 'Eskema', connected: 'konektatuta', closed: 'itxita', connect: 'Konektatu', disconnect: 'Deskonektatu', reconnect: 'Berriz konektatu', methods: 'Metodoak', request: 'Eskaera', send: 'Bidali', messages: 'Mezuak', mcpTools: 'Eskemaren toolak', arguments: 'Argumentuak', call: 'Deitu', result: 'Emaitza', pickTool: 'Aukeratu tool bat', publicUrls: 'Bere garraioen beste URL batzuk', publicUrlsNote: 'IDEaren zerbitzariak bere REST, WebSocket edo MCP gatewayak esandako atakatan iristen ez baditu bakarrik (proxy bat aurrean, beste sare bat): beren URLa hemen.', restUrl: 'RESTaren URLa', webSocketUrl: 'WebSocketaren URLa', mcpUrl: 'MCParen URLa', updated: 'UIaren bertsio berri bat dago gateway-an: kargatu berriz erabiltzeko (gordetakoa mantentzen da).', reload: 'Kargatu berriz', theme: 'Gaia', themeSystem: 'Sistema', themeLight: 'Argia', themeDark: 'Iluna', language: 'Hizkuntza',
		loading: 'Kargatzen…', remember: 'Gogoratu nazazu nabigatzaile honetan',
		authentication: 'Autentifikazioa', apikey: 'API gakoa', bearer: 'Bearer tokena', basic: 'Basic (erabiltzailea eta pasahitza)', none: 'Bat ere ez',
		header: 'Goiburua', user: 'Erabiltzailea', password: 'Pasahitza', key: 'Gakoa', token: 'Tokena', checking: 'Egiaztatzen…', show: 'Erakutsi', hide: 'Ezkutatu',
		invalid: 'Kredentziala ez da baliozkoa.',
		sessions: 'Saioak', mySessions: 'Nire saioak', activeSessions: 'Saio aktiboak', thisSession: 'hau', lastActivity: 'azken jarduera', endsAt: 'iraungitzen da', closeSession: 'Itxi', closeOthers: 'Itxi besteak', revokeSession: 'Baliogabetu', revokeAll: 'Baliogabetu denak', confirmRevokeAll: '{name}-ren saio guztiak baliogabetu? Erabiltzen dituenak berriro sartu beharko du.', lookingAt: 'begiratzen', noOtherSessions: 'Kredentzial honen beste saiorik ez dago.', sessionEnded: 'Saioa amaitu da: {reason}', sessionExpiring: 'Saioa 2 minutu barru iraungiko da: gorde editatzen ari zarena.', sessionsNote: 'IDEak gateway-ko saio batekin lan egiten du, kredentzial honekin irekia; jarduerarik gabeko denbora baten ondoren iraungitzen da.'
	}
}

export const textsOf = (locale: Locale): Texts => TEXTS[locale] ?? en
