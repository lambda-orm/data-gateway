import { Locale } from './i18n'

/** The texts of the form of the options of a query (OptionsForm) */
export interface OptionsMessages {
	form: string
	json: string
	stage: string
	stageHint: string
	/** the view, when the roles of the credential give more than one (data-gateway 4.4) */
	view: string
	viewHint: string
	chunkSize: string
	chunkSizeHint: string
	tryAllCan: string
	tryAllCanHint: string
	byDefault: string
	yes: string
	no: string
	headers: string
	headersHint: string
	addHeader: string
	headerName: string
	headerValue: string
	removeHeader: string
	timeout: string
	timeoutHint: string
	maxIterations: string
	maxIterationsHint: string
	wholeNumber: string
	invalid: string
	kept: string
	notInSchema: string
	none: string
	edit: string
	done: string
	invalidShort: string
	headersCount: string
}

const en: OptionsMessages = {
	form: 'form', json: 'JSON',
	stage: 'stage', stageHint: 'where it runs: a stage of the schema; empty, its default one',
	view: 'view', viewHint: 'what of the domain it sees: one of the views of your roles; empty, the one of your roles',
	chunkSize: 'chunk size', chunkSizeHint: 'rows per batch of a bulk operation: a whole number greater than 0; empty, all at once',
	tryAllCan: 'try all it can', tryAllCanHint: 'go on when a sentence fails; empty, the default (stop)',
	byDefault: '(default)', yes: 'yes', no: 'no',
	headers: 'headers', headersHint: 'pairs of name and value that go with the query',
	addHeader: 'add a header', headerName: 'name', headerValue: 'value', removeHeader: 'remove the header',
	timeout: 'timeout (ms)', timeoutHint: 'the script stops after this many milliseconds; empty, the limit of the gateway',
	maxIterations: 'max iterations', maxIterationsHint: 'loops of the script, all together; empty, the limit of the gateway',
	wholeNumber: 'a whole number greater than 0',
	invalid: 'The options are not a JSON object: fix them in JSON.',
	kept: 'Other options, kept as they are: {names}',
	notInSchema: 'not in this schema',
	none: 'none: the defaults', edit: 'edit', done: 'done', invalidShort: 'not a JSON object', headersCount: '{n} headers'
}

const MESSAGES: Record<Locale, OptionsMessages> = {
	en,
	es: {
		form: 'formulario', json: 'JSON',
		stage: 'stage', stageHint: 'dónde se ejecuta: un stage del esquema; vacío, el de por defecto',
		view: 'view', viewHint: 'qué ve del dominio: una de las vistas de tus roles; vacío, la de tus roles',
		chunkSize: 'tamaño de lote', chunkSizeHint: 'filas por lote de una operación masiva: un entero mayor que 0; vacío, todo junto',
		tryAllCan: 'intentar todo lo posible', tryAllCanHint: 'seguir cuando falla una sentencia; vacío, lo de por defecto (frenar)',
		byDefault: '(por defecto)', yes: 'sí', no: 'no',
		headers: 'cabeceras', headersHint: 'pares de nombre y valor que viajan con la consulta',
		addHeader: 'agregar una cabecera', headerName: 'nombre', headerValue: 'valor', removeHeader: 'quitar la cabecera',
		timeout: 'tiempo máximo (ms)', timeoutHint: 'el script se corta después de tantos milisegundos; vacío, el límite de la gateway',
		maxIterations: 'iteraciones máximas', maxIterationsHint: 'vueltas de los bucles del script, todas juntas; vacío, el límite de la gateway',
		wholeNumber: 'un entero mayor que 0',
		invalid: 'Las opciones no son un objeto JSON: corregilas en JSON.',
		kept: 'Otras opciones, que se mantienen como están: {names}',
		notInSchema: 'no está en este esquema',
	none: 'ninguna: las de por defecto', edit: 'editar', done: 'listo', invalidShort: 'no es un objeto JSON', headersCount: '{n} cabeceras'
	},
	pt: {
		form: 'formulário', json: 'JSON',
		stage: 'stage', stageHint: 'onde roda: um stage do esquema; vazio, o padrão',
		view: 'view', viewHint: 'o que vê do domínio: uma das views dos seus papéis; vazio, a dos seus papéis',
		chunkSize: 'tamanho do lote', chunkSizeHint: 'linhas por lote de uma operação em massa: um inteiro maior que 0; vazio, tudo de uma vez',
		tryAllCan: 'tentar tudo o possível', tryAllCanHint: 'continuar quando uma sentença falha; vazio, o padrão (parar)',
		byDefault: '(padrão)', yes: 'sim', no: 'não',
		headers: 'cabeçalhos', headersHint: 'pares de nome e valor que vão com a consulta',
		addHeader: 'adicionar um cabeçalho', headerName: 'nome', headerValue: 'valor', removeHeader: 'remover o cabeçalho',
		timeout: 'tempo máximo (ms)', timeoutHint: 'o script para depois de tantos milissegundos; vazio, o limite do gateway',
		maxIterations: 'iterações máximas', maxIterationsHint: 'voltas dos laços do script, todas juntas; vazio, o limite do gateway',
		wholeNumber: 'um inteiro maior que 0',
		invalid: 'As opções não são um objeto JSON: corrija-as em JSON.',
		kept: 'Outras opções, mantidas como estão: {names}',
		notInSchema: 'não está neste esquema',
	none: 'nenhuma: as padrão', edit: 'editar', done: 'pronto', invalidShort: 'não é um objeto JSON', headersCount: '{n} cabeçalhos'
	},
	fr: {
		form: 'formulaire', json: 'JSON',
		stage: 'stage', stageHint: 'où elle s’exécute : un stage du schéma ; vide, celui par défaut',
		view: 'view', viewHint: 'ce qu’elle voit du domaine : une des vues de vos rôles ; vide, celle de vos rôles',
		chunkSize: 'taille de lot', chunkSizeHint: 'lignes par lot d’une opération en masse : un entier supérieur à 0 ; vide, tout d’un coup',
		tryAllCan: 'tenter tout le possible', tryAllCanHint: 'continuer quand une instruction échoue ; vide, par défaut (s’arrêter)',
		byDefault: '(par défaut)', yes: 'oui', no: 'non',
		headers: 'en-têtes', headersHint: 'paires de nom et valeur qui accompagnent la requête',
		addHeader: 'ajouter un en-tête', headerName: 'nom', headerValue: 'valeur', removeHeader: 'retirer l’en-tête',
		timeout: 'délai (ms)', timeoutHint: 'le script s’arrête après autant de millisecondes ; vide, la limite de la gateway',
		maxIterations: 'itérations max', maxIterationsHint: 'tours des boucles du script, toutes ensemble ; vide, la limite de la gateway',
		wholeNumber: 'un entier supérieur à 0',
		invalid: 'Les options ne sont pas un objet JSON : corrigez-les en JSON.',
		kept: 'Autres options, gardées telles quelles : {names}',
		notInSchema: 'absent de ce schéma',
	none: 'aucune : celles par défaut', edit: 'modifier', done: 'terminé', invalidShort: 'pas un objet JSON', headersCount: '{n} en-têtes'
	},
	it: {
		form: 'modulo', json: 'JSON',
		stage: 'stage', stageHint: 'dove viene eseguita: uno stage dello schema; vuoto, quello predefinito',
		view: 'view', viewHint: 'cosa vede del dominio: una delle viste dei tuoi ruoli; vuoto, quella dei tuoi ruoli',
		chunkSize: 'dimensione del blocco', chunkSizeHint: 'righe per blocco di un’operazione massiva: un intero maggiore di 0; vuoto, tutto insieme',
		tryAllCan: 'tentare tutto il possibile', tryAllCanHint: 'continuare quando un’istruzione fallisce; vuoto, il predefinito (fermarsi)',
		byDefault: '(predefinito)', yes: 'sì', no: 'no',
		headers: 'intestazioni', headersHint: 'coppie di nome e valore che accompagnano la query',
		addHeader: 'aggiungi un’intestazione', headerName: 'nome', headerValue: 'valore', removeHeader: 'rimuovi l’intestazione',
		timeout: 'timeout (ms)', timeoutHint: 'lo script si ferma dopo tanti millisecondi; vuoto, il limite del gateway',
		maxIterations: 'iterazioni massime', maxIterationsHint: 'giri dei cicli dello script, tutti insieme; vuoto, il limite del gateway',
		wholeNumber: 'un intero maggiore di 0',
		invalid: 'Le opzioni non sono un oggetto JSON: correggile in JSON.',
		kept: 'Altre opzioni, mantenute così come sono: {names}',
		notInSchema: 'non è in questo schema',
	none: 'nessuna: quelle predefinite', edit: 'modifica', done: 'fatto', invalidShort: 'non è un oggetto JSON', headersCount: '{n} intestazioni'
	},
	de: {
		form: 'Formular', json: 'JSON',
		stage: 'Stage', stageHint: 'wo sie läuft: eine Stage des Schemas; leer, die Standard-Stage',
		view: 'View', viewHint: 'was sie von der Domäne sieht: eine der Views Ihrer Rollen; leer, die Ihrer Rollen',
		chunkSize: 'Blockgröße', chunkSizeHint: 'Zeilen pro Block einer Massenoperation: eine ganze Zahl größer als 0; leer, alles auf einmal',
		tryAllCan: 'so viel wie möglich versuchen', tryAllCanHint: 'weitermachen, wenn eine Anweisung fehlschlägt; leer, der Standard (anhalten)',
		byDefault: '(Standard)', yes: 'ja', no: 'nein',
		headers: 'Header', headersHint: 'Paare aus Name und Wert, die mit der Abfrage gesendet werden',
		addHeader: 'Header hinzufügen', headerName: 'Name', headerValue: 'Wert', removeHeader: 'Header entfernen',
		timeout: 'Zeitlimit (ms)', timeoutHint: 'das Skript stoppt nach so vielen Millisekunden; leer, das Limit des Gateways',
		maxIterations: 'max. Iterationen', maxIterationsHint: 'Durchläufe der Schleifen des Skripts, alle zusammen; leer, das Limit des Gateways',
		wholeNumber: 'eine ganze Zahl größer als 0',
		invalid: 'Die Optionen sind kein JSON-Objekt: korrigiere sie im JSON.',
		kept: 'Weitere Optionen, unverändert beibehalten: {names}',
		notInSchema: 'nicht in diesem Schema',
	none: 'keine: die Standardwerte', edit: 'bearbeiten', done: 'fertig', invalidShort: 'kein JSON-Objekt', headersCount: '{n} Header'
	},
	nl: {
		form: 'formulier', json: 'JSON',
		stage: 'stage', stageHint: 'waar ze draait: een stage van het schema; leeg, de standaard',
		view: 'view', viewHint: 'wat ze van het domein ziet: een van de views van je rollen; leeg, die van je rollen',
		chunkSize: 'blokgrootte', chunkSizeHint: 'rijen per blok van een bulkbewerking: een geheel getal groter dan 0; leeg, alles tegelijk',
		tryAllCan: 'alles proberen wat kan', tryAllCanHint: 'doorgaan als een opdracht mislukt; leeg, de standaard (stoppen)',
		byDefault: '(standaard)', yes: 'ja', no: 'nee',
		headers: 'headers', headersHint: 'paren van naam en waarde die met de query meegaan',
		addHeader: 'een header toevoegen', headerName: 'naam', headerValue: 'waarde', removeHeader: 'de header verwijderen',
		timeout: 'time-out (ms)', timeoutHint: 'het script stopt na zoveel milliseconden; leeg, de limiet van de gateway',
		maxIterations: 'max. iteraties', maxIterationsHint: 'rondes van de lussen van het script, allemaal samen; leeg, de limiet van de gateway',
		wholeNumber: 'een geheel getal groter dan 0',
		invalid: 'De opties zijn geen JSON-object: corrigeer ze in JSON.',
		kept: 'Andere opties, ongewijzigd bewaard: {names}',
		notInSchema: 'niet in dit schema',
	none: 'geen: de standaard', edit: 'bewerken', done: 'klaar', invalidShort: 'geen JSON-object', headersCount: '{n} headers'
	},
	ca: {
		form: 'formulari', json: 'JSON',
		stage: 'stage', stageHint: 'on s’executa: un stage de l’esquema; buit, el per defecte',
		view: 'view', viewHint: 'què veu del domini: una de les vistes dels teus rols; buit, la dels teus rols',
		chunkSize: 'mida del lot', chunkSizeHint: 'files per lot d’una operació massiva: un enter més gran que 0; buit, tot de cop',
		tryAllCan: 'intentar tot el possible', tryAllCanHint: 'continuar quan falla una sentència; buit, el per defecte (aturar-se)',
		byDefault: '(per defecte)', yes: 'sí', no: 'no',
		headers: 'capçaleres', headersHint: 'parells de nom i valor que viatgen amb la consulta',
		addHeader: 'afegir una capçalera', headerName: 'nom', headerValue: 'valor', removeHeader: 'treure la capçalera',
		timeout: 'temps màxim (ms)', timeoutHint: 'l’script s’atura després de tants mil·lisegons; buit, el límit de la gateway',
		maxIterations: 'iteracions màximes', maxIterationsHint: 'voltes dels bucles de l’script, totes juntes; buit, el límit de la gateway',
		wholeNumber: 'un enter més gran que 0',
		invalid: 'Les opcions no són un objecte JSON: corregeix-les en JSON.',
		kept: 'Altres opcions, mantingudes tal com són: {names}',
		notInSchema: 'no és en aquest esquema',
	none: 'cap: les per defecte', edit: 'editar', done: 'fet', invalidShort: 'no és un objecte JSON', headersCount: '{n} capçaleres'
	},
	gl: {
		form: 'formulario', json: 'JSON',
		stage: 'stage', stageHint: 'onde se executa: un stage do esquema; baleiro, o predeterminado',
		view: 'view', viewHint: 'que ve do dominio: unha das vistas dos teus roles; baleiro, a dos teus roles',
		chunkSize: 'tamaño do lote', chunkSizeHint: 'filas por lote dunha operación masiva: un enteiro maior que 0; baleiro, todo xunto',
		tryAllCan: 'intentar todo o posible', tryAllCanHint: 'seguir cando falla unha sentenza; baleiro, o predeterminado (parar)',
		byDefault: '(predeterminado)', yes: 'si', no: 'non',
		headers: 'cabeceiras', headersHint: 'pares de nome e valor que van coa consulta',
		addHeader: 'engadir unha cabeceira', headerName: 'nome', headerValue: 'valor', removeHeader: 'quitar a cabeceira',
		timeout: 'tempo máximo (ms)', timeoutHint: 'o script detense despois de tantos milisegundos; baleiro, o límite da gateway',
		maxIterations: 'iteracións máximas', maxIterationsHint: 'voltas dos bucles do script, todas xuntas; baleiro, o límite da gateway',
		wholeNumber: 'un enteiro maior que 0',
		invalid: 'As opcións non son un obxecto JSON: corríxeas en JSON.',
		kept: 'Outras opcións, mantidas como están: {names}',
		notInSchema: 'non está neste esquema',
	none: 'ningunha: as predeterminadas', edit: 'editar', done: 'listo', invalidShort: 'non é un obxecto JSON', headersCount: '{n} cabeceiras'
	},
	eu: {
		form: 'formularioa', json: 'JSON',
		stage: 'stage', stageHint: 'non exekutatzen den: eskemaren stage bat; hutsik, lehenetsia',
		view: 'view', viewHint: 'domeinutik zer ikusten duen: zure rolen view bat; hutsik, zure rolena',
		chunkSize: 'sortaren tamaina', chunkSizeHint: 'eragiketa masibo baten sorta bakoitzeko errenkadak: 0 baino handiagoa den zenbaki oso bat; hutsik, dena batera',
		tryAllCan: 'ahal den guztia saiatu', tryAllCanHint: 'jarraitu sententzia batek huts egiten duenean; hutsik, lehenetsia (gelditu)',
		byDefault: '(lehenetsia)', yes: 'bai', no: 'ez',
		headers: 'goiburuak', headersHint: 'kontsultarekin doazen izen eta balio bikoteak',
		addHeader: 'gehitu goiburu bat', headerName: 'izena', headerValue: 'balioa', removeHeader: 'kendu goiburua',
		timeout: 'denbora-muga (ms)', timeoutHint: 'scripta gelditzen da hainbat milisegundoren ondoren; hutsik, gateway-aren muga',
		maxIterations: 'gehienezko iterazioak', maxIterationsHint: 'scriptaren begizten itzuliak, guztiak batera; hutsik, gateway-aren muga',
		wholeNumber: '0 baino handiagoa den zenbaki oso bat',
		invalid: 'Aukerak ez dira JSON objektu bat: zuzendu JSONean.',
		kept: 'Beste aukera batzuk, dauden bezala gordeta: {names}',
		notInSchema: 'ez dago eskema honetan',
	none: 'bat ere ez: lehenetsiak', edit: 'editatu', done: 'eginda', invalidShort: 'ez da JSON objektu bat', headersCount: '{n} goiburu'
	}
}

export const optionsMessagesOf = (locale: string | undefined): OptionsMessages =>
	MESSAGES[(locale as Locale)] ?? MESSAGES[(locale ?? '').slice(0, 2) as Locale] ?? en
