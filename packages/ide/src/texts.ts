import type { Locale } from '@lambdaorm/ui'

/** The texts of the app (the components bring their own); the example query and the names (REST, MCP…) stay as they are */
export interface Texts {
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
	apiDocs: 'API docs', login: 'Login', logout: 'Logout', back: 'Back', queries: 'Queries', goToQueries: 'Go to the queries',
	theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark', language: 'Language',
	lead: 'The data of this instance — its entities, their relations and their rows — through one model and one query language, whichever database holds them.',
	queriesAre: 'Queries are lambda expressions over the domain, not SQL:',
	translated: 'The gateway translates them for each source (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), checks the permissions of the credential (read, write, scripts…) and audits what changes data.',
	workbenchTitle: 'Query workbench',
	workbenchText: 'Write queries with the autocompletion of the model, check their plan and parameters, run them and see the result as a table, JSON or YAML — several at once, in tabs.',
	restText: 'The same operations for applications: execute, plan, metadata, the schema and its stages.', restDocs: 'Its documentation',
	mcpTitle: 'MCP and WebSocket', mcpText: 'Where it is enabled, AI agents query through MCP tools, and clients get notifications over WebSocket.',
	schemas: 'Schemas', loading: 'Loading…', noSchemas: 'No schema is served.', route: 'Route', status: 'Status',
	loginNote: 'The credential stays in this tab only: closing it or reloading forgets it.',
	authentication: 'Authentication', apikey: 'API key', bearer: 'Bearer token', basic: 'Basic (user and password)', none: 'None',
	header: 'Header', user: 'User', password: 'Password', key: 'Key', token: 'Token', checking: 'Checking…', show: 'Show', hide: 'Hide',
	invalid: 'The credential is not valid.', noReady: 'No schema is ready: try again in a moment.'
}

const TEXTS: Record<Locale, Texts> = {
	en,
	es: {
		apiDocs: 'Documentación de la API', login: 'Ingresar', logout: 'Salir', back: 'Volver', queries: 'Consultas', goToQueries: 'Ir a las consultas',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Oscuro', language: 'Idioma',
		lead: 'Los datos de esta instancia — sus entidades, sus relaciones y sus filas — a través de un modelo y un lenguaje de consulta, sea cual sea la base que los guarde.',
		queriesAre: 'Las consultas son expresiones lambda sobre el dominio, no SQL:',
		translated: 'El gateway las traduce para cada origen (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), controla los permisos de la credencial (lectura, escritura, scripts…) y audita lo que cambia datos.',
		workbenchTitle: 'Banco de consultas',
		workbenchText: 'Escribí consultas con el autocompletado del modelo, revisá su plan y sus parámetros, ejecutalas y mirá el resultado como tabla, JSON o YAML — varias a la vez, en pestañas.',
		restText: 'Las mismas operaciones para las aplicaciones: execute, plan, metadata, el esquema y sus stages.', restDocs: 'Su documentación',
		mcpTitle: 'MCP y WebSocket', mcpText: 'Donde está habilitado, los agentes de IA consultan con herramientas MCP y los clientes reciben notificaciones por WebSocket.',
		schemas: 'Esquemas', loading: 'Cargando…', noSchemas: 'No se sirve ningún esquema.', route: 'Ruta', status: 'Estado',
		loginNote: 'La credencial queda solo en esta pestaña: al cerrarla o recargar se olvida.',
		authentication: 'Autenticación', apikey: 'API key', bearer: 'Token Bearer', basic: 'Basic (usuario y contraseña)', none: 'Ninguna',
		header: 'Header', user: 'Usuario', password: 'Contraseña', key: 'Clave', token: 'Token', checking: 'Verificando…', show: 'Mostrar', hide: 'Ocultar',
		invalid: 'La credencial no es válida.', noReady: 'Ningún esquema está listo: probá de nuevo en un momento.'
	},
	pt: {
		apiDocs: 'Documentação da API', login: 'Entrar', logout: 'Sair', back: 'Voltar', queries: 'Consultas', goToQueries: 'Ir para as consultas',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Escuro', language: 'Idioma',
		lead: 'Os dados desta instância — suas entidades, suas relações e suas linhas — por meio de um modelo e uma linguagem de consulta, seja qual for o banco que os guarda.',
		queriesAre: 'As consultas são expressões lambda sobre o domínio, não SQL:',
		translated: 'O gateway as traduz para cada origem (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), verifica as permissões da credencial (leitura, escrita, scripts…) e audita o que altera dados.',
		workbenchTitle: 'Bancada de consultas',
		workbenchText: 'Escreva consultas com o autocompletar do modelo, confira o plano e os parâmetros, execute-as e veja o resultado como tabela, JSON ou YAML — várias ao mesmo tempo, em abas.',
		restText: 'As mesmas operações para aplicações: execute, plan, metadata, o esquema e seus stages.', restDocs: 'A sua documentação',
		mcpTitle: 'MCP e WebSocket', mcpText: 'Onde estiver habilitado, agentes de IA consultam por ferramentas MCP e os clientes recebem notificações por WebSocket.',
		schemas: 'Esquemas', loading: 'Carregando…', noSchemas: 'Nenhum esquema é servido.', route: 'Rota', status: 'Estado',
		loginNote: 'A credencial fica apenas nesta aba: fechá-la ou recarregar a esquece.',
		authentication: 'Autenticação', apikey: 'API key', bearer: 'Token Bearer', basic: 'Basic (usuário e senha)', none: 'Nenhuma',
		header: 'Header', user: 'Usuário', password: 'Senha', key: 'Chave', token: 'Token', checking: 'Verificando…', show: 'Mostrar', hide: 'Ocultar',
		invalid: 'A credencial não é válida.', noReady: 'Nenhum esquema está pronto: tente de novo em instantes.'
	},
	fr: {
		apiDocs: "Documentation de l'API", login: 'Connexion', logout: 'Déconnexion', back: 'Retour', queries: 'Requêtes', goToQueries: 'Aller aux requêtes',
		theme: 'Thème', themeSystem: 'Système', themeLight: 'Clair', themeDark: 'Sombre', language: 'Langue',
		lead: 'Les données de cette instance — ses entités, leurs relations et leurs lignes — à travers un modèle et un langage de requête, quelle que soit la base qui les contient.',
		queriesAre: 'Les requêtes sont des expressions lambda sur le domaine, pas du SQL :',
		translated: 'La passerelle les traduit pour chaque source (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), vérifie les permissions de l’identifiant (lecture, écriture, scripts…) et audite ce qui modifie les données.',
		workbenchTitle: 'Atelier de requêtes',
		workbenchText: 'Écrivez des requêtes avec l’autocomplétion du modèle, vérifiez leur plan et leurs paramètres, exécutez-les et voyez le résultat en tableau, JSON ou YAML — plusieurs à la fois, dans des onglets.',
		restText: 'Les mêmes opérations pour les applications : execute, plan, metadata, le schéma et ses stages.', restDocs: 'Sa documentation',
		mcpTitle: 'MCP et WebSocket', mcpText: 'Là où c’est activé, les agents d’IA interrogent via des outils MCP et les clients reçoivent des notifications par WebSocket.',
		schemas: 'Schémas', loading: 'Chargement…', noSchemas: 'Aucun schéma n’est servi.', route: 'Route', status: 'État',
		loginNote: 'L’identifiant reste uniquement dans cet onglet : le fermer ou recharger l’oublie.',
		authentication: 'Authentification', apikey: 'Clé d’API', bearer: 'Jeton Bearer', basic: 'Basic (utilisateur et mot de passe)', none: 'Aucune',
		header: 'En-tête', user: 'Utilisateur', password: 'Mot de passe', key: 'Clé', token: 'Jeton', checking: 'Vérification…', show: 'Afficher', hide: 'Masquer',
		invalid: 'L’identifiant n’est pas valide.', noReady: 'Aucun schéma n’est prêt : réessayez dans un instant.'
	},
	it: {
		apiDocs: "Documentazione dell'API", login: 'Accedi', logout: 'Esci', back: 'Indietro', queries: 'Query', goToQueries: 'Vai alle query',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Chiaro', themeDark: 'Scuro', language: 'Lingua',
		lead: 'I dati di questa istanza — le sue entità, le loro relazioni e le loro righe — attraverso un modello e un linguaggio di interrogazione, qualunque sia il database che li contiene.',
		queriesAre: 'Le query sono espressioni lambda sul dominio, non SQL:',
		translated: 'Il gateway le traduce per ogni sorgente (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), controlla i permessi della credenziale (lettura, scrittura, script…) e registra ciò che modifica i dati.',
		workbenchTitle: 'Banco di query',
		workbenchText: 'Scrivi query con il completamento automatico del modello, controlla piano e parametri, eseguile e guarda il risultato come tabella, JSON o YAML — più di una alla volta, in schede.',
		restText: 'Le stesse operazioni per le applicazioni: execute, plan, metadata, lo schema e i suoi stage.', restDocs: 'La sua documentazione',
		mcpTitle: 'MCP e WebSocket', mcpText: 'Dove è abilitato, gli agenti di IA interrogano tramite strumenti MCP e i client ricevono notifiche via WebSocket.',
		schemas: 'Schemi', loading: 'Caricamento…', noSchemas: 'Nessuno schema è servito.', route: 'Percorso', status: 'Stato',
		loginNote: 'La credenziale resta solo in questa scheda: chiuderla o ricaricare la dimentica.',
		authentication: 'Autenticazione', apikey: 'Chiave API', bearer: 'Token Bearer', basic: 'Basic (utente e password)', none: 'Nessuna',
		header: 'Header', user: 'Utente', password: 'Password', key: 'Chiave', token: 'Token', checking: 'Verifica…', show: 'Mostra', hide: 'Nascondi',
		invalid: 'La credenziale non è valida.', noReady: 'Nessuno schema è pronto: riprova tra un momento.'
	},
	de: {
		apiDocs: 'API-Dokumentation', login: 'Anmelden', logout: 'Abmelden', back: 'Zurück', queries: 'Abfragen', goToQueries: 'Zu den Abfragen',
		theme: 'Design', themeSystem: 'System', themeLight: 'Hell', themeDark: 'Dunkel', language: 'Sprache',
		lead: 'Die Daten dieser Instanz — ihre Entitäten, deren Beziehungen und Zeilen — über ein Modell und eine Abfragesprache, egal welche Datenbank sie hält.',
		queriesAre: 'Abfragen sind Lambda-Ausdrücke über die Domäne, kein SQL:',
		translated: 'Das Gateway übersetzt sie für jede Quelle (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), prüft die Berechtigungen der Anmeldedaten (Lesen, Schreiben, Skripte…) und protokolliert, was Daten ändert.',
		workbenchTitle: 'Abfrage-Werkbank',
		workbenchText: 'Schreibe Abfragen mit der Autovervollständigung des Modells, prüfe Plan und Parameter, führe sie aus und sieh das Ergebnis als Tabelle, JSON oder YAML — mehrere gleichzeitig, in Tabs.',
		restText: 'Dieselben Operationen für Anwendungen: execute, plan, metadata, das Schema und seine Stages.', restDocs: 'Ihre Dokumentation',
		mcpTitle: 'MCP und WebSocket', mcpText: 'Wo aktiviert, fragen KI-Agenten über MCP-Tools ab, und Clients erhalten Benachrichtigungen über WebSocket.',
		schemas: 'Schemas', loading: 'Wird geladen…', noSchemas: 'Es wird kein Schema bereitgestellt.', route: 'Pfad', status: 'Status',
		loginNote: 'Die Anmeldedaten bleiben nur in diesem Tab: Schließen oder Neuladen vergisst sie.',
		authentication: 'Authentifizierung', apikey: 'API-Schlüssel', bearer: 'Bearer-Token', basic: 'Basic (Benutzer und Passwort)', none: 'Keine',
		header: 'Header', user: 'Benutzer', password: 'Passwort', key: 'Schlüssel', token: 'Token', checking: 'Wird geprüft…', show: 'Anzeigen', hide: 'Verbergen',
		invalid: 'Die Anmeldedaten sind nicht gültig.', noReady: 'Kein Schema ist bereit: versuche es gleich noch einmal.'
	},
	nl: {
		apiDocs: 'API-documentatie', login: 'Inloggen', logout: 'Uitloggen', back: 'Terug', queries: 'Query’s', goToQueries: 'Naar de query’s',
		theme: 'Thema', themeSystem: 'Systeem', themeLight: 'Licht', themeDark: 'Donker', language: 'Taal',
		lead: 'De gegevens van deze instantie — haar entiteiten, hun relaties en hun rijen — via één model en één querytaal, welke database ze ook bewaart.',
		queriesAre: 'Query’s zijn lambda-expressies over het domein, geen SQL:',
		translated: 'De gateway vertaalt ze voor elke bron (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), controleert de machtigingen van de inloggegevens (lezen, schrijven, scripts…) en registreert wat gegevens wijzigt.',
		workbenchTitle: 'Query-werkbank',
		workbenchText: 'Schrijf query’s met de automatische aanvulling van het model, controleer hun plan en parameters, voer ze uit en bekijk het resultaat als tabel, JSON of YAML — meerdere tegelijk, in tabbladen.',
		restText: 'Dezelfde bewerkingen voor applicaties: execute, plan, metadata, het schema en zijn stages.', restDocs: 'De documentatie',
		mcpTitle: 'MCP en WebSocket', mcpText: 'Waar ingeschakeld, vragen AI-agents op via MCP-tools en krijgen clients meldingen via WebSocket.',
		schemas: 'Schema’s', loading: 'Laden…', noSchemas: 'Er wordt geen schema aangeboden.', route: 'Route', status: 'Status',
		loginNote: 'De inloggegevens blijven alleen in dit tabblad: sluiten of herladen vergeet ze.',
		authentication: 'Authenticatie', apikey: 'API-sleutel', bearer: 'Bearer-token', basic: 'Basic (gebruiker en wachtwoord)', none: 'Geen',
		header: 'Header', user: 'Gebruiker', password: 'Wachtwoord', key: 'Sleutel', token: 'Token', checking: 'Controleren…', show: 'Tonen', hide: 'Verbergen',
		invalid: 'De inloggegevens zijn niet geldig.', noReady: 'Geen enkel schema is klaar: probeer het zo opnieuw.'
	},
	ca: {
		apiDocs: "Documentació de l'API", login: 'Inicia la sessió', logout: 'Tanca la sessió', back: 'Enrere', queries: 'Consultes', goToQueries: 'Ves a les consultes',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Clar', themeDark: 'Fosc', language: 'Idioma',
		lead: 'Les dades d’aquesta instància — les seves entitats, les seves relacions i les seves files — a través d’un model i un llenguatge de consulta, sigui quina sigui la base que les guarda.',
		queriesAre: 'Les consultes són expressions lambda sobre el domini, no SQL:',
		translated: 'El gateway les tradueix per a cada origen (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), comprova els permisos de la credencial (lectura, escriptura, scripts…) i audita el que canvia dades.',
		workbenchTitle: 'Banc de consultes',
		workbenchText: 'Escriu consultes amb l’autocompleció del model, revisa’n el pla i els paràmetres, executa-les i mira el resultat com a taula, JSON o YAML — diverses alhora, en pestanyes.',
		restText: 'Les mateixes operacions per a les aplicacions: execute, plan, metadata, l’esquema i els seus stages.', restDocs: 'La seva documentació',
		mcpTitle: 'MCP i WebSocket', mcpText: 'On està habilitat, els agents d’IA consulten amb eines MCP i els clients reben notificacions per WebSocket.',
		schemas: 'Esquemes', loading: 'S’està carregant…', noSchemas: 'No se serveix cap esquema.', route: 'Ruta', status: 'Estat',
		loginNote: 'La credencial només es queda en aquesta pestanya: tancar-la o recarregar l’oblida.',
		authentication: 'Autenticació', apikey: 'Clau d’API', bearer: 'Token Bearer', basic: 'Basic (usuari i contrasenya)', none: 'Cap',
		header: 'Capçalera', user: 'Usuari', password: 'Contrasenya', key: 'Clau', token: 'Token', checking: 'S’està comprovant…', show: 'Mostra', hide: 'Amaga',
		invalid: 'La credencial no és vàlida.', noReady: 'Cap esquema no està a punt: torna-ho a provar d’aquí a un moment.'
	},
	gl: {
		apiDocs: 'Documentación da API', login: 'Entrar', logout: 'Saír', back: 'Volver', queries: 'Consultas', goToQueries: 'Ir ás consultas',
		theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Escuro', language: 'Idioma',
		lead: 'Os datos desta instancia — as súas entidades, as súas relacións e as súas filas — a través dun modelo e unha linguaxe de consulta, sexa cal sexa a base que os garda.',
		queriesAre: 'As consultas son expresións lambda sobre o dominio, non SQL:',
		translated: 'O gateway tradúceas para cada orixe (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), comproba os permisos da credencial (lectura, escritura, scripts…) e audita o que cambia datos.',
		workbenchTitle: 'Banco de consultas',
		workbenchText: 'Escribe consultas co autocompletado do modelo, revisa o seu plan e os seus parámetros, execútaas e mira o resultado como táboa, JSON ou YAML — varias á vez, en lapelas.',
		restText: 'As mesmas operacións para as aplicacións: execute, plan, metadata, o esquema e os seus stages.', restDocs: 'A súa documentación',
		mcpTitle: 'MCP e WebSocket', mcpText: 'Onde está habilitado, os axentes de IA consultan con ferramentas MCP e os clientes reciben notificacións por WebSocket.',
		schemas: 'Esquemas', loading: 'Cargando…', noSchemas: 'Non se serve ningún esquema.', route: 'Ruta', status: 'Estado',
		loginNote: 'A credencial queda só nesta lapela: pechala ou recargar esquécea.',
		authentication: 'Autenticación', apikey: 'Chave de API', bearer: 'Token Bearer', basic: 'Basic (usuario e contrasinal)', none: 'Ningunha',
		header: 'Cabeceira', user: 'Usuario', password: 'Contrasinal', key: 'Chave', token: 'Token', checking: 'Comprobando…', show: 'Amosar', hide: 'Agochar',
		invalid: 'A credencial non é válida.', noReady: 'Ningún esquema está listo: téntao de novo nun momento.'
	},
	eu: {
		apiDocs: 'APIaren dokumentazioa', login: 'Hasi saioa', logout: 'Itxi saioa', back: 'Atzera', queries: 'Kontsultak', goToQueries: 'Joan kontsultetara',
		theme: 'Gaia', themeSystem: 'Sistema', themeLight: 'Argia', themeDark: 'Iluna', language: 'Hizkuntza',
		lead: 'Instantzia honen datuak — bere entitateak, haien erlazioak eta errenkadak — eredu bakar baten eta kontsulta-lengoaia bakar baten bidez, edozein datu-basetan daudela ere.',
		queriesAre: 'Kontsultak domeinuaren gaineko lambda adierazpenak dira, ez SQL:',
		translated: 'Gatewayak iturri bakoitzerako itzultzen ditu (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB), kredentzialaren baimenak egiaztatzen ditu (irakurri, idatzi, scriptak…) eta datuak aldatzen dituena auditatzen du.',
		workbenchTitle: 'Kontsulta-mahaia',
		workbenchText: 'Idatzi kontsultak ereduaren osaketa automatikoarekin, egiaztatu haien plana eta parametroak, exekutatu eta ikusi emaitza taula, JSON edo YAML gisa — hainbat aldi berean, fitxetan.',
		restText: 'Eragiketa berak aplikazioentzat: execute, plan, metadata, eskema eta bere stageak.', restDocs: 'Bere dokumentazioa',
		mcpTitle: 'MCP eta WebSocket', mcpText: 'Gaituta dagoen lekuan, AA agenteek MCP tresnen bidez kontsultatzen dute, eta bezeroek jakinarazpenak jasotzen dituzte WebSocket bidez.',
		schemas: 'Eskemak', loading: 'Kargatzen…', noSchemas: 'Ez da eskemarik zerbitzatzen.', route: 'Bidea', status: 'Egoera',
		loginNote: 'Kredentziala fitxa honetan bakarrik geratzen da: ixteak edo birkargatzeak ahazten du.',
		authentication: 'Autentifikazioa', apikey: 'API gakoa', bearer: 'Bearer tokena', basic: 'Basic (erabiltzailea eta pasahitza)', none: 'Bat ere ez',
		header: 'Goiburua', user: 'Erabiltzailea', password: 'Pasahitza', key: 'Gakoa', token: 'Tokena', checking: 'Egiaztatzen…', show: 'Erakutsi', hide: 'Ezkutatu',
		invalid: 'Kredentziala ez da baliozkoa.', noReady: 'Eskema bat ere ez dago prest: saiatu berriro une batean.'
	}
}

export const textsOf = (locale: Locale): Texts => TEXTS[locale] ?? en
