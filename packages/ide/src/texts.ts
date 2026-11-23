import type { Locale } from '@lambdaorm/ui'

/** The texts of the app (the components bring their own); the example query and the names (REST, MCP…) stay as they are */
export interface Texts {
	/** an asset of the page is not in the gateway any more: it was updated while the page was open */
	account: string
	preferences: string
	accountUser: string
	accountAuthentication: string
	permissions: string
	close: string
	notLoggedIn: string
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
	webSocketUrl: string
	mcpUrl: string
	updated: string
	reload: string
	apiDocs: string
	login: string
	logout: string
	back: string
	queries: string
	goToQueries: string
	theme: string
	themeSystem: string
	themeLight: string
	themeDark: string
	language: string
	lead: string
	queriesAre: string
	translated: string
	workbenchTitle: string
	workbenchText: string
	restText: string
	restDocs: string
	mcpTitle: string
	mcpText: string
	schemas: string
	loading: string
	noSchemas: string
	route: string
	status: string
	loginNote: string
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
	noReady: string
}

const en: Texts = {
	account: 'Account', preferences: 'Preferences', accountUser: 'User', accountAuthentication: 'Authentication', permissions: 'Permissions', close: 'Close', notLoggedIn: 'Not logged in', headerName: 'header', culture: 'Regional format', cultureNote: 'numbers and dates of the results (tree and table)', documentation: 'Documentation', connection: 'Connection', current: 'current', notConnected: 'not connected', connectedAs: 'Connected as {name}', unreachable: 'The data-gateway can’t be reached (its URL, or it doesn’t allow this origin: CORS).', connectionName: 'Name', protocol: 'Protocol', address: 'Address (host:port/base path)', rememberKey: 'Remember the key in this browser', connectionNote: 'The connection stays in this browser; the schemas, workspaces and projects are in the data-gateway.', confirmRemove: 'Remove this connection from the IDE? (nothing is removed from the data-gateway)', removeConnection: 'Remove', test: 'Test', saveConnection: 'Save', addConnection: 'Connect', newConnection: 'New connection', needsKey: 'Its key: open the connection to enter it', menu: 'Menu', cancel: 'Cancel', connections: 'Connections', editConnection: 'Edit the connection', tools: 'Tools', openSwagger: 'REST API (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'not exposed by this data-gateway', schema: 'Schema', connected: 'connected', closed: 'closed', connect: 'Connect', disconnect: 'Disconnect', reconnect: 'Connect again', methods: 'Methods', request: 'Request', send: 'Send', messages: 'Messages', mcpTools: 'Tools of the schema', arguments: 'Arguments', call: 'Call', result: 'Result', pickTool: 'Choose a tool', publicUrls: 'Public URLs (behind a proxy)', publicUrlsNote: 'Only when its WebSocket or MCP are not reached at the ports the gateway tells (a proxy in front): their URL here.', webSocketUrl: 'WebSocket URL', mcpUrl: 'MCP URL', updated: 'A new version of the UI is in the gateway: reload to use it (what is saved stays).', reload: 'Reload', apiDocs: 'API docs', login: 'Login', logout: 'Logout', back: 'Back', queries: 'Queries', goToQueries: 'Go to the queries',
	theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark', language: 'Language',
	lead: 'The data of this instance — its entities, their relations and their rows — through one model and one query language, whichever database holds them.',
	queriesAre: 'Queries are lambda expressions over the domain, not SQL:',
	translated: 'The gateway translates them for each source (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), checks the permissions of the credential (read, write, scripts…) and audits what changes data.',
	workbenchTitle: 'Query workbench',
	workbenchText: 'Write queries with the autocompletion of the model, check their plan and parameters, run them and see the result as a table, JSON or YAML — several at once, in tabs.',
	restText: 'The same operations for applications: execute, plan, metadata, the schema and its stages.', restDocs: 'Its documentation',
	mcpTitle: 'MCP and WebSocket', mcpText: 'Where it is enabled, AI agents query through MCP tools, and clients get notifications over WebSocket.',
	schemas: 'Schemas', loading: 'Loading…', noSchemas: 'No schema is served.', route: 'Route', status: 'Status',
	loginNote: 'The credential stays in this tab: a reload keeps it, closing the tab forgets it (unless you check remember me).', remember: 'Remember me in this browser',
	authentication: 'Authentication', apikey: 'API key', bearer: 'Bearer token', basic: 'Basic (user and password)', none: 'None',
	header: 'Header', user: 'User', password: 'Password', key: 'Key', token: 'Token', checking: 'Checking…', show: 'Show', hide: 'Hide',
	invalid: 'The credential is not valid.', noReady: 'No schema is ready: try again in a moment.'
}

const TEXTS: Record<Locale, Texts> = {
	en,
	es: {
		account: 'Cuenta', preferences: 'Preferencias', accountUser: 'Usuario', accountAuthentication: 'Autenticación', permissions: 'Permisos', close: 'Cerrar', notLoggedIn: 'Sin sesión', headerName: 'cabecera', culture: 'Formato regional', cultureNote: 'números y fechas de los resultados (árbol y tabla)', documentation: 'Documentación', connection: 'Conexión', current: 'actual', notConnected: 'sin conectar', connectedAs: 'Conectado como {name}', unreachable: 'No se llega a la data-gateway (su URL, o no permite este origen: CORS).', connectionName: 'Nombre', protocol: 'Protocolo', address: 'Dirección (host:puerto/ruta base)', rememberKey: 'Recordar la clave en este navegador', connectionNote: 'La conexión queda en este navegador; los esquemas, workspaces y proyectos están en la data-gateway.', confirmRemove: '¿Quitar esta conexión del IDE? (no se borra nada de la data-gateway)', removeConnection: 'Quitar', test: 'Probar', saveConnection: 'Guardar', addConnection: 'Conectar', newConnection: 'Nueva conexión', needsKey: 'Falta su clave: abrí la conexión para ingresarla', menu: 'Menú', cancel: 'Cancelar', connections: 'Conexiones', editConnection: 'Editar la conexión', tools: 'Herramientas', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'esta data-gateway no lo expone', schema: 'Esquema', connected: 'conectado', closed: 'cerrado', connect: 'Conectar', disconnect: 'Desconectar', reconnect: 'Reconectar', methods: 'Métodos', request: 'Pedido', send: 'Enviar', messages: 'Mensajes', mcpTools: 'Tools del esquema', arguments: 'Argumentos', call: 'Llamar', result: 'Resultado', pickTool: 'Elegí una tool', publicUrls: 'URLs públicas (detrás de un proxy)', publicUrlsNote: 'Solo si su WebSocket o su MCP no se alcanzan en los puertos que la gateway dice (un proxy adelante): su URL acá.', webSocketUrl: 'URL del WebSocket', mcpUrl: 'URL del MCP', updated: 'Hay una versión nueva de la UI en la gateway: recargá para usarla (lo guardado se mantiene).', reload: 'Recargar', apiDocs: 'Documentación de la API', login: 'Ingresar', logout: 'Salir', back: 'Volver', queries: 'Consultas', goToQueries: 'Ir a las consultas',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Oscuro', language: 'Idioma',
		lead: 'Los datos de esta instancia — sus entidades, sus relaciones y sus filas — a través de un modelo y un lenguaje de consulta, sea cual sea la base que los guarde.',
		queriesAre: 'Las consultas son expresiones lambda sobre el dominio, no SQL:',
		translated: 'El gateway las traduce para cada origen (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), controla los permisos de la credencial (lectura, escritura, scripts…) y audita lo que cambia datos.',
		workbenchTitle: 'Banco de consultas',
		workbenchText: 'Escribí consultas con el autocompletado del modelo, revisá su plan y sus parámetros, ejecutalas y mirá el resultado como tabla, JSON o YAML — varias a la vez, en pestañas.',
		restText: 'Las mismas operaciones para las aplicaciones: execute, plan, metadata, el esquema y sus stages.', restDocs: 'Su documentación',
		mcpTitle: 'MCP y WebSocket', mcpText: 'Donde está habilitado, los agentes de IA consultan con herramientas MCP y los clientes reciben notificaciones por WebSocket.',
		schemas: 'Esquemas', loading: 'Cargando…', noSchemas: 'No se sirve ningún esquema.', route: 'Ruta', status: 'Estado',
		loginNote: 'La credencial queda en esta pestaña: un refresco la mantiene, cerrar la pestaña la olvida (salvo que tildes recordarme).', remember: 'Recordarme en este navegador',
		authentication: 'Autenticación', apikey: 'API key', bearer: 'Token Bearer', basic: 'Basic (usuario y contraseña)', none: 'Ninguna',
		header: 'Header', user: 'Usuario', password: 'Contraseña', key: 'Clave', token: 'Token', checking: 'Verificando…', show: 'Mostrar', hide: 'Ocultar',
		invalid: 'La credencial no es válida.', noReady: 'Ningún esquema está listo: probá de nuevo en un momento.'
	},
	pt: {
		account: 'Conta', preferences: 'Preferências', accountUser: 'Usuário', accountAuthentication: 'Autenticação', permissions: 'Permissões', close: 'Fechar', notLoggedIn: 'Sem sessão', headerName: 'cabeçalho', culture: 'Formato regional', cultureNote: 'números e datas dos resultados (árvore e tabela)', documentation: 'Documentação', connection: 'Conexão', current: 'atual', notConnected: 'não conectada', connectedAs: 'Conectado como {name}', unreachable: 'Não se chega à data-gateway (sua URL, ou ela não permite esta origem: CORS).', connectionName: 'Nome', protocol: 'Protocolo', address: 'Endereço (host:porta/caminho base)', rememberKey: 'Lembrar a chave neste navegador', connectionNote: 'A conexão fica neste navegador; os esquemas, workspaces e projetos estão na data-gateway.', confirmRemove: 'Remover esta conexão do IDE? (nada é removido da data-gateway)', removeConnection: 'Remover', test: 'Testar', saveConnection: 'Salvar', addConnection: 'Conectar', newConnection: 'Nova conexão', needsKey: 'Falta a chave: abra a conexão para informá-la', menu: 'Menu', cancel: 'Cancelar', connections: 'Conexões', editConnection: 'Editar a conexão', tools: 'Ferramentas', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'esta data-gateway não o expõe', schema: 'Esquema', connected: 'conectado', closed: 'fechado', connect: 'Conectar', disconnect: 'Desconectar', reconnect: 'Reconectar', methods: 'Métodos', request: 'Requisição', send: 'Enviar', messages: 'Mensagens', mcpTools: 'Tools do esquema', arguments: 'Argumentos', call: 'Chamar', result: 'Resultado', pickTool: 'Escolha uma tool', publicUrls: 'URLs públicas (atrás de um proxy)', publicUrlsNote: 'Só se o WebSocket ou o MCP não forem alcançados nas portas que a gateway informa (um proxy na frente): a URL aqui.', webSocketUrl: 'URL do WebSocket', mcpUrl: 'URL do MCP', updated: 'Há uma versão nova da UI na gateway: recarregue para usá-la (o que está salvo permanece).', reload: 'Recarregar', apiDocs: 'Documentação da API', login: 'Entrar', logout: 'Sair', back: 'Voltar', queries: 'Consultas', goToQueries: 'Ir para as consultas',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Escuro', language: 'Idioma',
		lead: 'Os dados desta instância — suas entidades, suas relações e suas linhas — por meio de um modelo e uma linguagem de consulta, seja qual for o banco que os guarda.',
		queriesAre: 'As consultas são expressões lambda sobre o domínio, não SQL:',
		translated: 'O gateway as traduz para cada origem (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), verifica as permissões da credencial (leitura, escrita, scripts…) e audita o que altera dados.',
		workbenchTitle: 'Bancada de consultas',
		workbenchText: 'Escreva consultas com o autocompletar do modelo, confira o plano e os parâmetros, execute-as e veja o resultado como tabela, JSON ou YAML — várias ao mesmo tempo, em abas.',
		restText: 'As mesmas operações para aplicações: execute, plan, metadata, o esquema e seus stages.', restDocs: 'A sua documentação',
		mcpTitle: 'MCP e WebSocket', mcpText: 'Onde estiver habilitado, agentes de IA consultam por ferramentas MCP e os clientes recebem notificações por WebSocket.',
		schemas: 'Esquemas', loading: 'Carregando…', noSchemas: 'Nenhum esquema é servido.', route: 'Rota', status: 'Estado',
		loginNote: 'A credencial fica nesta aba: recarregar a mantém, fechar a aba a esquece (a menos que marque lembrar-me).', remember: 'Lembrar-me neste navegador',
		authentication: 'Autenticação', apikey: 'API key', bearer: 'Token Bearer', basic: 'Basic (usuário e senha)', none: 'Nenhuma',
		header: 'Header', user: 'Usuário', password: 'Senha', key: 'Chave', token: 'Token', checking: 'Verificando…', show: 'Mostrar', hide: 'Ocultar',
		invalid: 'A credencial não é válida.', noReady: 'Nenhum esquema está pronto: tente de novo em instantes.'
	},
	fr: {
		account: 'Compte', preferences: 'Préférences', accountUser: 'Utilisateur', accountAuthentication: 'Authentification', permissions: 'Permissions', close: 'Fermer', notLoggedIn: 'Non connecté', headerName: 'en-tête', culture: 'Format régional', cultureNote: 'nombres et dates des résultats (arbre et tableau)', documentation: 'Documentation', connection: 'Connexion', current: 'actuelle', notConnected: 'non connectée', connectedAs: 'Connecté en tant que {name}', unreachable: 'La data-gateway est injoignable (son URL, ou elle n’autorise pas cette origine : CORS).', connectionName: 'Nom', protocol: 'Protocole', address: 'Adresse (hôte:port/chemin de base)', rememberKey: 'Retenir la clé dans ce navigateur', connectionNote: 'La connexion reste dans ce navigateur ; les schémas, workspaces et projets sont dans la data-gateway.', confirmRemove: 'Retirer cette connexion de l’IDE ? (rien n’est supprimé de la data-gateway)', removeConnection: 'Retirer', test: 'Tester', saveConnection: 'Enregistrer', addConnection: 'Connecter', newConnection: 'Nouvelle connexion', needsKey: 'Sa clé manque : ouvrez la connexion pour la saisir', menu: 'Menu', cancel: 'Annuler', connections: 'Connexions', editConnection: 'Modifier la connexion', tools: 'Outils', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'non exposé par cette data-gateway', schema: 'Schéma', connected: 'connecté', closed: 'fermé', connect: 'Connecter', disconnect: 'Déconnecter', reconnect: 'Reconnecter', methods: 'Méthodes', request: 'Requête', send: 'Envoyer', messages: 'Messages', mcpTools: 'Outils du schéma', arguments: 'Arguments', call: 'Appeler', result: 'Résultat', pickTool: 'Choisissez un outil', publicUrls: 'URL publiques (derrière un proxy)', publicUrlsNote: 'Seulement si son WebSocket ou son MCP ne sont pas joignables aux ports indiqués par la gateway (un proxy devant) : leur URL ici.', webSocketUrl: 'URL du WebSocket', mcpUrl: 'URL du MCP', updated: 'Une nouvelle version de l’UI est dans la gateway : rechargez pour l’utiliser (ce qui est enregistré reste).', reload: 'Recharger', apiDocs: "Documentation de l'API", login: 'Connexion', logout: 'Déconnexion', back: 'Retour', queries: 'Requêtes', goToQueries: 'Aller aux requêtes',
		theme: 'Thème', themeSystem: 'Système', themeLight: 'Clair', themeDark: 'Sombre', language: 'Langue',
		lead: 'Les données de cette instance — ses entités, leurs relations et leurs lignes — à travers un modèle et un langage de requête, quelle que soit la base qui les contient.',
		queriesAre: 'Les requêtes sont des expressions lambda sur le domaine, pas du SQL :',
		translated: 'La passerelle les traduit pour chaque source (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), vérifie les permissions de l’identifiant (lecture, écriture, scripts…) et audite ce qui modifie les données.',
		workbenchTitle: 'Atelier de requêtes',
		workbenchText: 'Écrivez des requêtes avec l’autocomplétion du modèle, vérifiez leur plan et leurs paramètres, exécutez-les et voyez le résultat en tableau, JSON ou YAML — plusieurs à la fois, dans des onglets.',
		restText: 'Les mêmes opérations pour les applications : execute, plan, metadata, le schéma et ses stages.', restDocs: 'Sa documentation',
		mcpTitle: 'MCP et WebSocket', mcpText: 'Là où c’est activé, les agents d’IA interrogent via des outils MCP et les clients reçoivent des notifications par WebSocket.',
		schemas: 'Schémas', loading: 'Chargement…', noSchemas: 'Aucun schéma n’est servi.', route: 'Route', status: 'État',
		loginNote: 'L’identifiant reste dans cet onglet : un rechargement le garde, fermer l’onglet l’oublie (sauf si vous cochez se souvenir de moi).', remember: 'Se souvenir de moi dans ce navigateur',
		authentication: 'Authentification', apikey: 'Clé d’API', bearer: 'Jeton Bearer', basic: 'Basic (utilisateur et mot de passe)', none: 'Aucune',
		header: 'En-tête', user: 'Utilisateur', password: 'Mot de passe', key: 'Clé', token: 'Jeton', checking: 'Vérification…', show: 'Afficher', hide: 'Masquer',
		invalid: 'L’identifiant n’est pas valide.', noReady: 'Aucun schéma n’est prêt : réessayez dans un instant.'
	},
	it: {
		account: 'Account', preferences: 'Preferenze', accountUser: 'Utente', accountAuthentication: 'Autenticazione', permissions: 'Permessi', close: 'Chiudi', notLoggedIn: 'Non connesso', headerName: 'intestazione', culture: 'Formato regionale', cultureNote: 'numeri e date dei risultati (albero e tabella)', documentation: 'Documentazione', connection: 'Connessione', current: 'attuale', notConnected: 'non connessa', connectedAs: 'Connesso come {name}', unreachable: 'La data-gateway non è raggiungibile (il suo URL, o non permette questa origine: CORS).', connectionName: 'Nome', protocol: 'Protocollo', address: 'Indirizzo (host:porta/percorso base)', rememberKey: 'Ricorda la chiave in questo browser', connectionNote: 'La connessione resta in questo browser; schemi, workspace e progetti sono nella data-gateway.', confirmRemove: 'Rimuovere questa connessione dall’IDE? (nulla viene eliminato dalla data-gateway)', removeConnection: 'Rimuovi', test: 'Prova', saveConnection: 'Salva', addConnection: 'Connetti', newConnection: 'Nuova connessione', needsKey: 'Manca la chiave: apri la connessione per inserirla', menu: 'Menu', cancel: 'Annulla', connections: 'Connessioni', editConnection: 'Modifica la connessione', tools: 'Strumenti', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'non esposto da questa data-gateway', schema: 'Schema', connected: 'connesso', closed: 'chiuso', connect: 'Connetti', disconnect: 'Disconnetti', reconnect: 'Riconnetti', methods: 'Metodi', request: 'Richiesta', send: 'Invia', messages: 'Messaggi', mcpTools: 'Tool dello schema', arguments: 'Argomenti', call: 'Chiama', result: 'Risultato', pickTool: 'Scegli un tool', publicUrls: 'URL pubblici (dietro un proxy)', publicUrlsNote: 'Solo se il suo WebSocket o il suo MCP non si raggiungono alle porte che dice il gateway (un proxy davanti): il loro URL qui.', webSocketUrl: 'URL del WebSocket', mcpUrl: 'URL del MCP', updated: 'C’è una nuova versione della UI nel gateway: ricarica per usarla (ciò che è salvato resta).', reload: 'Ricarica', apiDocs: "Documentazione dell'API", login: 'Accedi', logout: 'Esci', back: 'Indietro', queries: 'Query', goToQueries: 'Vai alle query',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Chiaro', themeDark: 'Scuro', language: 'Lingua',
		lead: 'I dati di questa istanza — le sue entità, le loro relazioni e le loro righe — attraverso un modello e un linguaggio di interrogazione, qualunque sia il database che li contiene.',
		queriesAre: 'Le query sono espressioni lambda sul dominio, non SQL:',
		translated: 'Il gateway le traduce per ogni sorgente (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), controlla i permessi della credenziale (lettura, scrittura, script…) e registra ciò che modifica i dati.',
		workbenchTitle: 'Banco di query',
		workbenchText: 'Scrivi query con il completamento automatico del modello, controlla piano e parametri, eseguile e guarda il risultato come tabella, JSON o YAML — più di una alla volta, in schede.',
		restText: 'Le stesse operazioni per le applicazioni: execute, plan, metadata, lo schema e i suoi stage.', restDocs: 'La sua documentazione',
		mcpTitle: 'MCP e WebSocket', mcpText: 'Dove è abilitato, gli agenti di IA interrogano tramite strumenti MCP e i client ricevono notifiche via WebSocket.',
		schemas: 'Schemi', loading: 'Caricamento…', noSchemas: 'Nessuno schema è servito.', route: 'Percorso', status: 'Stato',
		loginNote: 'La credenziale resta in questa scheda: ricaricare la mantiene, chiudere la scheda la dimentica (a meno che tu non selezioni ricordami).', remember: 'Ricordami in questo browser',
		authentication: 'Autenticazione', apikey: 'Chiave API', bearer: 'Token Bearer', basic: 'Basic (utente e password)', none: 'Nessuna',
		header: 'Header', user: 'Utente', password: 'Password', key: 'Chiave', token: 'Token', checking: 'Verifica…', show: 'Mostra', hide: 'Nascondi',
		invalid: 'La credenziale non è valida.', noReady: 'Nessuno schema è pronto: riprova tra un momento.'
	},
	de: {
		account: 'Konto', preferences: 'Einstellungen', accountUser: 'Benutzer', accountAuthentication: 'Authentifizierung', permissions: 'Berechtigungen', close: 'Schließen', notLoggedIn: 'Nicht angemeldet', headerName: 'Header', culture: 'Regionales Format', cultureNote: 'Zahlen und Daten der Ergebnisse (Baum und Tabelle)', documentation: 'Dokumentation', connection: 'Verbindung', current: 'aktuell', notConnected: 'nicht verbunden', connectedAs: 'Verbunden als {name}', unreachable: 'Das data-gateway ist nicht erreichbar (seine URL, oder es erlaubt diesen Ursprung nicht: CORS).', connectionName: 'Name', protocol: 'Protokoll', address: 'Adresse (Host:Port/Basispfad)', rememberKey: 'Schlüssel in diesem Browser merken', connectionNote: 'Die Verbindung bleibt in diesem Browser; Schemas, Workspaces und Projekte liegen im data-gateway.', confirmRemove: 'Diese Verbindung aus der IDE entfernen? (im data-gateway wird nichts gelöscht)', removeConnection: 'Entfernen', test: 'Testen', saveConnection: 'Speichern', addConnection: 'Verbinden', newConnection: 'Neue Verbindung', needsKey: 'Schlüssel fehlt: Verbindung öffnen, um ihn einzugeben', menu: 'Menü', cancel: 'Abbrechen', connections: 'Verbindungen', editConnection: 'Verbindung bearbeiten', tools: 'Werkzeuge', openSwagger: 'REST-API (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'von diesem data-gateway nicht angeboten', schema: 'Schema', connected: 'verbunden', closed: 'geschlossen', connect: 'Verbinden', disconnect: 'Trennen', reconnect: 'Erneut verbinden', methods: 'Methoden', request: 'Anfrage', send: 'Senden', messages: 'Nachrichten', mcpTools: 'Tools des Schemas', arguments: 'Argumente', call: 'Aufrufen', result: 'Ergebnis', pickTool: 'Wähle ein Tool', publicUrls: 'Öffentliche URLs (hinter einem Proxy)', publicUrlsNote: 'Nur wenn WebSocket oder MCP nicht an den Ports erreichbar sind, die das Gateway nennt (ein Proxy davor): ihre URL hier.', webSocketUrl: 'WebSocket-URL', mcpUrl: 'MCP-URL', updated: 'Im Gateway gibt es eine neue Version der UI: neu laden, um sie zu verwenden (Gespeichertes bleibt).', reload: 'Neu laden', apiDocs: 'API-Dokumentation', login: 'Anmelden', logout: 'Abmelden', back: 'Zurück', queries: 'Abfragen', goToQueries: 'Zu den Abfragen',
		theme: 'Design', themeSystem: 'System', themeLight: 'Hell', themeDark: 'Dunkel', language: 'Sprache',
		lead: 'Die Daten dieser Instanz — ihre Entitäten, deren Beziehungen und Zeilen — über ein Modell und eine Abfragesprache, egal welche Datenbank sie hält.',
		queriesAre: 'Abfragen sind Lambda-Ausdrücke über die Domäne, kein SQL:',
		translated: 'Das Gateway übersetzt sie für jede Quelle (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), prüft die Berechtigungen der Anmeldedaten (Lesen, Schreiben, Skripte…) und protokolliert, was Daten ändert.',
		workbenchTitle: 'Abfrage-Werkbank',
		workbenchText: 'Schreibe Abfragen mit der Autovervollständigung des Modells, prüfe Plan und Parameter, führe sie aus und sieh das Ergebnis als Tabelle, JSON oder YAML — mehrere gleichzeitig, in Tabs.',
		restText: 'Dieselben Operationen für Anwendungen: execute, plan, metadata, das Schema und seine Stages.', restDocs: 'Ihre Dokumentation',
		mcpTitle: 'MCP und WebSocket', mcpText: 'Wo aktiviert, fragen KI-Agenten über MCP-Tools ab, und Clients erhalten Benachrichtigungen über WebSocket.',
		schemas: 'Schemas', loading: 'Wird geladen…', noSchemas: 'Es wird kein Schema bereitgestellt.', route: 'Pfad', status: 'Status',
		loginNote: 'Die Anmeldedaten bleiben in diesem Tab: Neuladen behält sie, Schließen des Tabs vergisst sie (außer Sie wählen Angemeldet bleiben).', remember: 'In diesem Browser angemeldet bleiben',
		authentication: 'Authentifizierung', apikey: 'API-Schlüssel', bearer: 'Bearer-Token', basic: 'Basic (Benutzer und Passwort)', none: 'Keine',
		header: 'Header', user: 'Benutzer', password: 'Passwort', key: 'Schlüssel', token: 'Token', checking: 'Wird geprüft…', show: 'Anzeigen', hide: 'Verbergen',
		invalid: 'Die Anmeldedaten sind nicht gültig.', noReady: 'Kein Schema ist bereit: versuche es gleich noch einmal.'
	},
	nl: {
		account: 'Account', preferences: 'Voorkeuren', accountUser: 'Gebruiker', accountAuthentication: 'Authenticatie', permissions: 'Rechten', close: 'Sluiten', notLoggedIn: 'Niet ingelogd', headerName: 'header', culture: 'Regionale notatie', cultureNote: 'getallen en datums van de resultaten (boom en tabel)', documentation: 'Documentatie', connection: 'Verbinding', current: 'huidige', notConnected: 'niet verbonden', connectedAs: 'Verbonden als {name}', unreachable: 'De data-gateway is niet bereikbaar (de URL, of deze oorsprong is niet toegestaan: CORS).', connectionName: 'Naam', protocol: 'Protocol', address: 'Adres (host:poort/basispad)', rememberKey: 'Sleutel onthouden in deze browser', connectionNote: 'De verbinding blijft in deze browser; schema’s, workspaces en projecten staan in de data-gateway.', confirmRemove: 'Deze verbinding uit de IDE verwijderen? (er wordt niets uit de data-gateway verwijderd)', removeConnection: 'Verwijderen', test: 'Testen', saveConnection: 'Opslaan', addConnection: 'Verbinden', newConnection: 'Nieuwe verbinding', needsKey: 'Sleutel ontbreekt: open de verbinding om hem in te voeren', menu: 'Menu', cancel: 'Annuleren', connections: 'Verbindingen', editConnection: 'Verbinding bewerken', tools: 'Hulpmiddelen', openSwagger: 'REST-API (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'niet aangeboden door deze data-gateway', schema: 'Schema', connected: 'verbonden', closed: 'gesloten', connect: 'Verbinden', disconnect: 'Verbreken', reconnect: 'Opnieuw verbinden', methods: 'Methoden', request: 'Verzoek', send: 'Verzenden', messages: 'Berichten', mcpTools: 'Tools van het schema', arguments: 'Argumenten', call: 'Aanroepen', result: 'Resultaat', pickTool: 'Kies een tool', publicUrls: 'Publieke URL’s (achter een proxy)', publicUrlsNote: 'Alleen als de WebSocket of MCP niet bereikbaar zijn op de poorten die de gateway noemt (een proxy ervoor): hun URL hier.', webSocketUrl: 'WebSocket-URL', mcpUrl: 'MCP-URL', updated: 'Er staat een nieuwe versie van de UI in de gateway: herlaad om die te gebruiken (wat opgeslagen is blijft).', reload: 'Herladen', apiDocs: 'API-documentatie', login: 'Inloggen', logout: 'Uitloggen', back: 'Terug', queries: 'Query’s', goToQueries: 'Naar de query’s',
		theme: 'Thema', themeSystem: 'Systeem', themeLight: 'Licht', themeDark: 'Donker', language: 'Taal',
		lead: 'De gegevens van deze instantie — haar entiteiten, hun relaties en hun rijen — via één model en één querytaal, welke database ze ook bewaart.',
		queriesAre: 'Query’s zijn lambda-expressies over het domein, geen SQL:',
		translated: 'De gateway vertaalt ze voor elke bron (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), controleert de machtigingen van de inloggegevens (lezen, schrijven, scripts…) en registreert wat gegevens wijzigt.',
		workbenchTitle: 'Query-werkbank',
		workbenchText: 'Schrijf query’s met de automatische aanvulling van het model, controleer hun plan en parameters, voer ze uit en bekijk het resultaat als tabel, JSON of YAML — meerdere tegelijk, in tabbladen.',
		restText: 'Dezelfde bewerkingen voor applicaties: execute, plan, metadata, het schema en zijn stages.', restDocs: 'De documentatie',
		mcpTitle: 'MCP en WebSocket', mcpText: 'Waar ingeschakeld, vragen AI-agents op via MCP-tools en krijgen clients meldingen via WebSocket.',
		schemas: 'Schema’s', loading: 'Laden…', noSchemas: 'Er wordt geen schema aangeboden.', route: 'Route', status: 'Status',
		loginNote: 'De referentie blijft in dit tabblad: herladen houdt haar, het tabblad sluiten vergeet haar (tenzij je onthoud mij aanvinkt).', remember: 'Onthoud mij in deze browser',
		authentication: 'Authenticatie', apikey: 'API-sleutel', bearer: 'Bearer-token', basic: 'Basic (gebruiker en wachtwoord)', none: 'Geen',
		header: 'Header', user: 'Gebruiker', password: 'Wachtwoord', key: 'Sleutel', token: 'Token', checking: 'Controleren…', show: 'Tonen', hide: 'Verbergen',
		invalid: 'De inloggegevens zijn niet geldig.', noReady: 'Geen enkel schema is klaar: probeer het zo opnieuw.'
	},
	ca: {
		account: 'Compte', preferences: 'Preferències', accountUser: 'Usuari', accountAuthentication: 'Autenticació', permissions: 'Permisos', close: 'Tanca', notLoggedIn: 'Sense sessió', headerName: 'capçalera', culture: 'Format regional', cultureNote: 'números i dates dels resultats (arbre i taula)', documentation: 'Documentació', connection: 'Connexió', current: 'actual', notConnected: 'sense connectar', connectedAs: 'Connectat com a {name}', unreachable: 'No s’arriba a la data-gateway (la seva URL, o no permet aquest origen: CORS).', connectionName: 'Nom', protocol: 'Protocol', address: 'Adreça (host:port/camí base)', rememberKey: 'Recorda la clau en aquest navegador', connectionNote: 'La connexió queda en aquest navegador; els esquemes, workspaces i projectes són a la data-gateway.', confirmRemove: 'Treure aquesta connexió de l’IDE? (no s’esborra res de la data-gateway)', removeConnection: 'Treu', test: 'Prova', saveConnection: 'Desa', addConnection: 'Connecta', newConnection: 'Connexió nova', needsKey: 'Falta la clau: obre la connexió per introduir-la', menu: 'Menú', cancel: 'Cancel·la', connections: 'Connexions', editConnection: 'Edita la connexió', tools: 'Eines', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'aquesta data-gateway no l’exposa', schema: 'Esquema', connected: 'connectat', closed: 'tancat', connect: 'Connecta', disconnect: 'Desconnecta', reconnect: 'Reconnecta', methods: 'Mètodes', request: 'Petició', send: 'Envia', messages: 'Missatges', mcpTools: 'Tools de l’esquema', arguments: 'Arguments', call: 'Crida', result: 'Resultat', pickTool: 'Tria una tool', publicUrls: 'URLs públiques (darrere d’un proxy)', publicUrlsNote: 'Només si el seu WebSocket o MCP no s’assoleixen als ports que diu la gateway (un proxy davant): la seva URL aquí.', webSocketUrl: 'URL del WebSocket', mcpUrl: 'URL del MCP', updated: 'Hi ha una versió nova de la UI a la gateway: recarrega per fer-la servir (el que està desat es manté).', reload: 'Recarrega', apiDocs: "Documentació de l'API", login: 'Inicia la sessió', logout: 'Tanca la sessió', back: 'Enrere', queries: 'Consultes', goToQueries: 'Ves a les consultes',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Clar', themeDark: 'Fosc', language: 'Idioma',
		lead: 'Les dades d’aquesta instància — les seves entitats, les seves relacions i les seves files — a través d’un model i un llenguatge de consulta, sigui quina sigui la base que les guarda.',
		queriesAre: 'Les consultes són expressions lambda sobre el domini, no SQL:',
		translated: 'El gateway les tradueix per a cada origen (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), comprova els permisos de la credencial (lectura, escriptura, scripts…) i audita el que canvia dades.',
		workbenchTitle: 'Banc de consultes',
		workbenchText: 'Escriu consultes amb l’autocompleció del model, revisa’n el pla i els paràmetres, executa-les i mira el resultat com a taula, JSON o YAML — diverses alhora, en pestanyes.',
		restText: 'Les mateixes operacions per a les aplicacions: execute, plan, metadata, l’esquema i els seus stages.', restDocs: 'La seva documentació',
		mcpTitle: 'MCP i WebSocket', mcpText: 'On està habilitat, els agents d’IA consulten amb eines MCP i els clients reben notificacions per WebSocket.',
		schemas: 'Esquemes', loading: 'S’està carregant…', noSchemas: 'No se serveix cap esquema.', route: 'Ruta', status: 'Estat',
		loginNote: 'La credencial queda en aquesta pestanya: recarregar la manté, tancar la pestanya l’oblida (tret que marquis recorda’m).', remember: 'Recorda’m en aquest navegador',
		authentication: 'Autenticació', apikey: 'Clau d’API', bearer: 'Token Bearer', basic: 'Basic (usuari i contrasenya)', none: 'Cap',
		header: 'Capçalera', user: 'Usuari', password: 'Contrasenya', key: 'Clau', token: 'Token', checking: 'S’està comprovant…', show: 'Mostra', hide: 'Amaga',
		invalid: 'La credencial no és vàlida.', noReady: 'Cap esquema no està a punt: torna-ho a provar d’aquí a un moment.'
	},
	gl: {
		account: 'Conta', preferences: 'Preferencias', accountUser: 'Usuario', accountAuthentication: 'Autenticación', permissions: 'Permisos', close: 'Pechar', notLoggedIn: 'Sen sesión', headerName: 'cabeceira', culture: 'Formato rexional', cultureNote: 'números e datas dos resultados (árbore e táboa)', documentation: 'Documentación', connection: 'Conexión', current: 'actual', notConnected: 'sen conectar', connectedAs: 'Conectado como {name}', unreachable: 'Non se chega á data-gateway (o seu URL, ou non permite esta orixe: CORS).', connectionName: 'Nome', protocol: 'Protocolo', address: 'Enderezo (host:porto/ruta base)', rememberKey: 'Lembrar a chave neste navegador', connectionNote: 'A conexión queda neste navegador; os esquemas, workspaces e proxectos están na data-gateway.', confirmRemove: 'Quitar esta conexión do IDE? (non se borra nada da data-gateway)', removeConnection: 'Quitar', test: 'Probar', saveConnection: 'Gardar', addConnection: 'Conectar', newConnection: 'Nova conexión', needsKey: 'Falta a chave: abre a conexión para introducila', menu: 'Menú', cancel: 'Cancelar', connections: 'Conexións', editConnection: 'Editar a conexión', tools: 'Ferramentas', openSwagger: 'API REST (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'esta data-gateway non o expón', schema: 'Esquema', connected: 'conectado', closed: 'pechado', connect: 'Conectar', disconnect: 'Desconectar', reconnect: 'Reconectar', methods: 'Métodos', request: 'Petición', send: 'Enviar', messages: 'Mensaxes', mcpTools: 'Tools do esquema', arguments: 'Argumentos', call: 'Chamar', result: 'Resultado', pickTool: 'Escolle unha tool', publicUrls: 'URLs públicas (detrás dun proxy)', publicUrlsNote: 'Só se o seu WebSocket ou MCP non se alcanzan nos portos que di a gateway (un proxy diante): o seu URL aquí.', webSocketUrl: 'URL do WebSocket', mcpUrl: 'URL do MCP', updated: 'Hai unha versión nova da UI na gateway: recarga para usala (o gardado mantense).', reload: 'Recargar', apiDocs: 'Documentación da API', login: 'Entrar', logout: 'Saír', back: 'Volver', queries: 'Consultas', goToQueries: 'Ir ás consultas',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Escuro', language: 'Idioma',
		lead: 'Os datos desta instancia — as súas entidades, as súas relacións e as súas filas — a través dun modelo e unha linguaxe de consulta, sexa cal sexa a base que os garda.',
		queriesAre: 'As consultas son expresións lambda sobre o dominio, non SQL:',
		translated: 'O gateway tradúceas para cada orixe (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), comproba os permisos da credencial (lectura, escritura, scripts…) e audita o que cambia datos.',
		workbenchTitle: 'Banco de consultas',
		workbenchText: 'Escribe consultas co autocompletado do modelo, revisa o seu plan e os seus parámetros, execútaas e mira o resultado como táboa, JSON ou YAML — varias á vez, en lapelas.',
		restText: 'As mesmas operacións para as aplicacións: execute, plan, metadata, o esquema e os seus stages.', restDocs: 'A súa documentación',
		mcpTitle: 'MCP e WebSocket', mcpText: 'Onde está habilitado, os axentes de IA consultan con ferramentas MCP e os clientes reciben notificacións por WebSocket.',
		schemas: 'Esquemas', loading: 'Cargando…', noSchemas: 'Non se serve ningún esquema.', route: 'Ruta', status: 'Estado',
		loginNote: 'A credencial queda nesta lapela: recargar mantéña, pechar a lapela esquécea (salvo que marques lembrarme).', remember: 'Lembrarme neste navegador',
		authentication: 'Autenticación', apikey: 'Chave de API', bearer: 'Token Bearer', basic: 'Basic (usuario e contrasinal)', none: 'Ningunha',
		header: 'Cabeceira', user: 'Usuario', password: 'Contrasinal', key: 'Chave', token: 'Token', checking: 'Comprobando…', show: 'Amosar', hide: 'Agochar',
		invalid: 'A credencial non é válida.', noReady: 'Ningún esquema está listo: téntao de novo nun momento.'
	},
	eu: {
		account: 'Kontua', preferences: 'Hobespenak', accountUser: 'Erabiltzailea', accountAuthentication: 'Autentifikazioa', permissions: 'Baimenak', close: 'Itxi', notLoggedIn: 'Saiorik gabe', headerName: 'goiburua', culture: 'Eskualde-formatua', cultureNote: 'emaitzen zenbakiak eta datak (zuhaitza eta taula)', documentation: 'Dokumentazioa', connection: 'Konexioa', current: 'unekoa', notConnected: 'konektatu gabe', connectedAs: '{name} gisa konektatuta', unreachable: 'Ezin da data-gatewayra iritsi (bere URLa, edo ez du jatorri hau onartzen: CORS).', connectionName: 'Izena', protocol: 'Protokoloa', address: 'Helbidea (host:ataka/oinarrizko bidea)', rememberKey: 'Gogoratu gakoa nabigatzaile honetan', connectionNote: 'Konexioa nabigatzaile honetan geratzen da; eskemak, workspaceak eta proiektuak data-gatewayan daude.', confirmRemove: 'Konexio hau IDEtik kendu? (ez da ezer ezabatzen data-gatewaytik)', removeConnection: 'Kendu', test: 'Probatu', saveConnection: 'Gorde', addConnection: 'Konektatu', newConnection: 'Konexio berria', needsKey: 'Gakoa falta da: ireki konexioa sartzeko', menu: 'Menua', cancel: 'Utzi', connections: 'Konexioak', editConnection: 'Editatu konexioa', tools: 'Tresnak', openSwagger: 'REST APIa (Swagger)', openWebSocket: 'WebSocket', openMcp: 'MCP', notExposed: 'data-gateway honek ez du eskaintzen', schema: 'Eskema', connected: 'konektatuta', closed: 'itxita', connect: 'Konektatu', disconnect: 'Deskonektatu', reconnect: 'Berriz konektatu', methods: 'Metodoak', request: 'Eskaera', send: 'Bidali', messages: 'Mezuak', mcpTools: 'Eskemaren toolak', arguments: 'Argumentuak', call: 'Deitu', result: 'Emaitza', pickTool: 'Aukeratu tool bat', publicUrls: 'URL publikoak (proxy baten atzean)', publicUrlsNote: 'Bere WebSocket edo MCP gatewayak esandako atakatan iristen ez badira bakarrik (proxy bat aurrean): beren URLa hemen.', webSocketUrl: 'WebSocketaren URLa', mcpUrl: 'MCParen URLa', updated: 'UIaren bertsio berri bat dago gateway-an: kargatu berriz erabiltzeko (gordetakoa mantentzen da).', reload: 'Kargatu berriz', apiDocs: 'APIaren dokumentazioa', login: 'Hasi saioa', logout: 'Itxi saioa', back: 'Atzera', queries: 'Kontsultak', goToQueries: 'Joan kontsultetara',
		theme: 'Gaia', themeSystem: 'Sistema', themeLight: 'Argia', themeDark: 'Iluna', language: 'Hizkuntza',
		lead: 'Instantzia honen datuak — bere entitateak, haien erlazioak eta errenkadak — eredu bakar baten eta kontsulta-lengoaia bakar baten bidez, edozein datu-basetan daudela ere.',
		queriesAre: 'Kontsultak domeinuaren gaineko lambda adierazpenak dira, ez SQL:',
		translated: 'Gatewayak iturri bakoitzerako itzultzen ditu (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), kredentzialaren baimenak egiaztatzen ditu (irakurri, idatzi, scriptak…) eta datuak aldatzen dituena auditatzen du.',
		workbenchTitle: 'Kontsulta-mahaia',
		workbenchText: 'Idatzi kontsultak ereduaren osaketa automatikoarekin, egiaztatu haien plana eta parametroak, exekutatu eta ikusi emaitza taula, JSON edo YAML gisa — hainbat aldi berean, fitxetan.',
		restText: 'Eragiketa berak aplikazioentzat: execute, plan, metadata, eskema eta bere stageak.', restDocs: 'Bere dokumentazioa',
		mcpTitle: 'MCP eta WebSocket', mcpText: 'Gaituta dagoen lekuan, AA agenteek MCP tresnen bidez kontsultatzen dute, eta bezeroek jakinarazpenak jasotzen dituzte WebSocket bidez.',
		schemas: 'Eskemak', loading: 'Kargatzen…', noSchemas: 'Ez da eskemarik zerbitzatzen.', route: 'Bidea', status: 'Egoera',
		loginNote: 'Kredentziala fitxa honetan geratzen da: berriz kargatzeak mantentzen du, fitxa ixteak ahazten du (gogoratu nazazu markatu ezean).', remember: 'Gogoratu nazazu nabigatzaile honetan',
		authentication: 'Autentifikazioa', apikey: 'API gakoa', bearer: 'Bearer tokena', basic: 'Basic (erabiltzailea eta pasahitza)', none: 'Bat ere ez',
		header: 'Goiburua', user: 'Erabiltzailea', password: 'Pasahitza', key: 'Gakoa', token: 'Tokena', checking: 'Egiaztatzen…', show: 'Erakutsi', hide: 'Ezkutatu',
		invalid: 'Kredentziala ez da baliozkoa.', noReady: 'Eskema bat ere ez dago prest: saiatu berriro une batean.'
	}
}

export const textsOf = (locale: Locale): Texts => TEXTS[locale] ?? en
