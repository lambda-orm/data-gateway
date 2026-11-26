import { format, Locale } from './i18n'

/** The texts of the explorer and the workspace; {name} is replaced */
export interface ExplorerMessages {
	explorer: string
	showExplorer: string
	hideExplorer: string
	domainYaml: string
	entities: string
	loading: string
	add: string
	newFolder: string
	newQuery: string
	newDiagram: string
	edit: string
	remove: string
	save: string
	saveAs: string
	saveQuery: string
	create: string
	cancel: string
	name: string
	description: string
	folder: string
	top: string
	deleteTitle: string
	confirmDelete: string
	confirmDeleteFolder: string
	exportWorkspace: string
	importWorkspace: string
	importMerge: string
	importReplace: string
	importDone: string
	invalidFile: string
	nameRequired: string
	nameTaken: string
	cannotMove: string
	notDurable: string
	unsaved: string
	saved: string
	readOnly: string
	nothingSaved: string
	openQuery: string
	properties: string
	relations: string
	keysIndexes: string
	data: string
	diagram: string
	referencedBy: string
	primaryKey: string
	uniqueKey: string
	indexes: string
	constraints: string
	usesProperties: string
	validationsHint: string
	refresh: string
	refreshOf: string
	helpReadExp: string
	helpWriteExp: string
	helpReadValue: string
	helpWriteValue: string
	type: string
	length: string
	required: string
	auto: string
	defaultValue: string
	references: string
	expressions: string
	expression: string
	expressionsOf: string
	entity: string
	from: string
	to: string
	cardinality: string
	weak: string
	fields: string
	message: string
	condition: string
	queryIt: string
	previous: string
	next: string
	page: string
	none: string
	abstract: string
	viewEntity: string
	extendsEntity: string
	openEntity: string
	readOnlyData: string
	dataEditHint: string
	dataNoKey: string
	addRow: string
	deleteRow: string
	confirmDeleteRow: string
	changedMeanwhile: string
	rowFilter: string
	applyFilter: string
	exportPage: string
	exportAll: string
	exportingRows: string
	exportLimit: string
	longitude: string
	latitude: string
	onMap: string
	vectorHint: string
	search: string
	addNeighbours: string
	clearSelection: string
	selectedCount: string
	chooseEntities: string
	editEntities: string
	saveDiagram: string
	nothingOpen: string
	open: string
	filterEntities: string
	matchesOf: string
	noMatches: string
	resizeExplorer: string
	schemaStatus: string
	noReason: string
	schemaPending: string
}

type Row = [keyof ExplorerMessages, string, string, string, string, string, string, string, string, string, string]

// en, es, pt, fr, it, de, nl, ca, gl, eu
const ROWS: Row[] = [
	['explorer', 'Explorer', 'Explorador', 'Explorador', 'Explorateur', 'Esplora', 'Explorer', 'Verkenner', 'Explorador', 'Explorador', 'Arakatzailea'],
	['showExplorer', 'show the explorer', 'mostrar el explorador', 'mostrar o explorador', "afficher l'explorateur", "mostra l'esplora", 'Explorer anzeigen', 'verkenner tonen', "mostra l'explorador", 'amosar o explorador', 'erakutsi arakatzailea'],
	['hideExplorer', 'hide the explorer', 'ocultar el explorador', 'ocultar o explorador', "masquer l'explorateur", "nascondi l'esplora", 'Explorer ausblenden', 'verkenner verbergen', "amaga l'explorador", 'agochar o explorador', 'ezkutatu arakatzailea'],
	['domainYaml', 'Domain (YAML)', 'Dominio (YAML)', 'Domínio (YAML)', 'Domaine (YAML)', 'Dominio (YAML)', 'Domäne (YAML)', 'Domein (YAML)', 'Domini (YAML)', 'Dominio (YAML)', 'Domeinua (YAML)'],
	['entities', 'Entities', 'Entidades', 'Entidades', 'Entités', 'Entità', 'Entitäten', 'Entiteiten', 'Entitats', 'Entidades', 'Entitateak'],
	['loading', 'Loading…', 'Cargando…', 'Carregando…', 'Chargement…', 'Caricamento…', 'Wird geladen…', 'Laden…', 'Carregant…', 'Cargando…', 'Kargatzen…'],
	['add', 'Add', 'Agregar', 'Adicionar', 'Ajouter', 'Aggiungi', 'Hinzufügen', 'Toevoegen', 'Afegeix', 'Engadir', 'Gehitu'],
	['newFolder', 'New folder', 'Nueva carpeta', 'Nova pasta', 'Nouveau dossier', 'Nuova cartella', 'Neuer Ordner', 'Nieuwe map', 'Carpeta nova', 'Novo cartafol', 'Karpeta berria'],
	['newQuery', 'New query', 'Nueva consulta', 'Nova consulta', 'Nouvelle requête', 'Nuova query', 'Neue Abfrage', 'Nieuwe query', 'Consulta nova', 'Nova consulta', 'Kontsulta berria'],
	['newDiagram', 'New diagram', 'Nuevo diagrama', 'Novo diagrama', 'Nouveau diagramme', 'Nuovo diagramma', 'Neues Diagramm', 'Nieuw diagram', 'Diagrama nou', 'Novo diagrama', 'Diagrama berria'],
	['edit', 'Edit', 'Editar', 'Editar', 'Modifier', 'Modifica', 'Bearbeiten', 'Bewerken', 'Edita', 'Editar', 'Editatu'],
	['remove', 'Delete', 'Eliminar', 'Excluir', 'Supprimer', 'Elimina', 'Löschen', 'Verwijderen', 'Elimina', 'Eliminar', 'Ezabatu'],
	['save', 'Save', 'Guardar', 'Salvar', 'Enregistrer', 'Salva', 'Speichern', 'Opslaan', 'Desa', 'Gardar', 'Gorde'],
	['saveAs', 'Save as…', 'Guardar como…', 'Salvar como…', 'Enregistrer sous…', 'Salva come…', 'Speichern unter…', 'Opslaan als…', 'Desa com a…', 'Gardar como…', 'Gorde honela…'],
	['saveQuery', 'Save the query', 'Guardar la consulta', 'Salvar a consulta', 'Enregistrer la requête', 'Salva la query', 'Abfrage speichern', 'Query opslaan', 'Desa la consulta', 'Gardar a consulta', 'Gorde kontsulta'],
	['create', 'Create', 'Crear', 'Criar', 'Créer', 'Crea', 'Erstellen', 'Maken', 'Crea', 'Crear', 'Sortu'],
	['cancel', 'Cancel', 'Cancelar', 'Cancelar', 'Annuler', 'Annulla', 'Abbrechen', 'Annuleren', 'Cancel·la', 'Cancelar', 'Utzi'],
	['name', 'Name', 'Nombre', 'Nome', 'Nom', 'Nome', 'Name', 'Naam', 'Nom', 'Nome', 'Izena'],
	['description', 'Description', 'Descripción', 'Descrição', 'Description', 'Descrizione', 'Beschreibung', 'Beschrijving', 'Descripció', 'Descrición', 'Deskribapena'],
	['folder', 'Folder', 'Carpeta', 'Pasta', 'Dossier', 'Cartella', 'Ordner', 'Map', 'Carpeta', 'Cartafol', 'Karpeta'],
	['top', '(top of the schema)', '(raíz del esquema)', '(raiz do esquema)', '(racine du schéma)', '(radice dello schema)', '(oberste Ebene des Schemas)', '(hoofdniveau van het schema)', "(arrel de l'esquema)", '(raíz do esquema)', '(eskemaren erroa)'],
	['deleteTitle', 'Delete', 'Eliminar', 'Excluir', 'Supprimer', 'Elimina', 'Löschen', 'Verwijderen', 'Elimina', 'Eliminar', 'Ezabatu'],
	['confirmDelete', 'Delete "{name}"? It cannot be undone.', '¿Eliminar "{name}"? No se puede deshacer.', 'Excluir "{name}"? Não é possível desfazer.', 'Supprimer « {name} » ? Impossible de revenir en arrière.', 'Eliminare "{name}"? Non si può annullare.', '„{name}“ löschen? Das lässt sich nicht rückgängig machen.', '"{name}" verwijderen? Dit kan niet ongedaan worden gemaakt.', 'Vols eliminar "{name}"? No es pot desfer.', 'Eliminar "{name}"? Non se pode desfacer.', '"{name}" ezabatu? Ezin da desegin.'],
	['confirmDeleteFolder', 'Delete the folder "{name}" and the {n} items in it? It cannot be undone.', '¿Eliminar la carpeta "{name}" y los {n} elementos que tiene? No se puede deshacer.', 'Excluir a pasta "{name}" e os {n} itens dela? Não é possível desfazer.', 'Supprimer le dossier « {name} » et ses {n} éléments ? Impossible de revenir en arrière.', 'Eliminare la cartella "{name}" e i {n} elementi che contiene? Non si può annullare.', 'Den Ordner „{name}“ und seine {n} Elemente löschen? Das lässt sich nicht rückgängig machen.', 'De map "{name}" en de {n} items erin verwijderen? Dit kan niet ongedaan worden gemaakt.', 'Vols eliminar la carpeta "{name}" i els {n} elements que conté? No es pot desfer.', 'Eliminar o cartafol "{name}" e os {n} elementos que ten? Non se pode desfacer.', '"{name}" karpeta eta bere {n} elementuak ezabatu? Ezin da desegin.'],
	['exportWorkspace', 'Export', 'Exportar', 'Exportar', 'Exporter', 'Esporta', 'Exportieren', 'Exporteren', 'Exporta', 'Exportar', 'Esportatu'],
	['importWorkspace', 'Import', 'Importar', 'Importar', 'Importer', 'Importa', 'Importieren', 'Importeren', 'Importa', 'Importar', 'Inportatu'],
	['importMerge', 'Add to what there is', 'Agregar a lo que hay', 'Adicionar ao que existe', "Ajouter à l'existant", 'Aggiungi a ciò che c’è', 'Zum Vorhandenen hinzufügen', 'Toevoegen aan wat er is', 'Afegeix al que hi ha', 'Engadir ao que hai', 'Gehitu dagoenari'],
	['importReplace', 'Replace everything', 'Reemplazar todo', 'Substituir tudo', 'Tout remplacer', 'Sostituisci tutto', 'Alles ersetzen', 'Alles vervangen', 'Substitueix-ho tot', 'Substituír todo', 'Ordeztu dena'],
	['importDone', '{n} items imported', '{n} elementos importados', '{n} itens importados', '{n} éléments importés', '{n} elementi importati', '{n} Elemente importiert', '{n} items geïmporteerd', '{n} elements importats', '{n} elementos importados', '{n} elementu inportatuta'],
	['invalidFile', 'The file is not a workspace export.', 'El archivo no es una exportación del espacio de trabajo.', 'O arquivo não é uma exportação do espaço de trabalho.', "Le fichier n'est pas un export de l'espace de travail.", "Il file non è un'esportazione dello spazio di lavoro.", 'Die Datei ist kein Export des Arbeitsbereichs.', 'Het bestand is geen export van de werkruimte.', "El fitxer no és una exportació de l'espai de treball.", 'O ficheiro non é unha exportación do espazo de traballo.', 'Fitxategia ez da lan-eremuaren esportazio bat.'],
	['nameRequired', 'The name is required.', 'El nombre es obligatorio.', 'O nome é obrigatório.', 'Le nom est obligatoire.', 'Il nome è obbligatorio.', 'Der Name ist erforderlich.', 'De naam is verplicht.', 'El nom és obligatori.', 'O nome é obrigatorio.', 'Izena derrigorrezkoa da.'],
	['nameTaken', 'There is already one with that name here.', 'Ya hay uno con ese nombre acá.', 'Já existe um com esse nome aqui.', 'Il en existe déjà un avec ce nom ici.', "Ce n'è già uno con questo nome qui.", 'Hier gibt es schon eines mit diesem Namen.', 'Hier bestaat er al een met die naam.', 'Ja n’hi ha un amb aquest nom aquí.', 'Xa hai un con ese nome aquí.', 'Badago izen hori duen bat hemen.'],
	['cannotMove', 'It cannot go there.', 'No se puede mover ahí.', 'Não pode ir para lá.', 'Impossible de le déplacer là.', 'Non può andare lì.', 'Es kann nicht dorthin.', 'Het kan daar niet heen.', 'No es pot moure aquí.', 'Non se pode mover aí.', 'Ezin da hara eraman.'],
	['notDurable', 'This browser does not let the page store data: what you save lasts until it is closed. Export it to keep it.', 'Este navegador no deja guardar datos: lo que guardes dura hasta cerrar la página. Exportalo para conservarlo.', 'Este navegador não permite guardar dados: o que salvar dura até fechar a página. Exporte para manter.', "Ce navigateur ne permet pas d'enregistrer des données : ce que vous enregistrez dure jusqu'à la fermeture de la page. Exportez-le pour le garder.", 'Questo browser non permette di salvare dati: ciò che salvi dura fino alla chiusura della pagina. Esportalo per conservarlo.', 'Dieser Browser erlaubt kein Speichern: Gespeichertes bleibt nur bis zum Schließen der Seite. Exportiere es, um es zu behalten.', 'Deze browser staat geen opslag toe: wat je opslaat blijft tot de pagina sluit. Exporteer het om het te bewaren.', 'Aquest navegador no deixa desar dades: el que desis dura fins que tanquis la pàgina. Exporta-ho per conservar-ho.', 'Este navegador non deixa gardar datos: o que gardes dura ata pechar a páxina. Expórtao para conservalo.', 'Nabigatzaile honek ez du daturik gordetzen uzten: gordetzen duzuna orria itxi arte irauten du. Esportatu gordetzeko.'],
	['unsaved', 'unsaved changes', 'cambios sin guardar', 'alterações não salvas', 'modifications non enregistrées', 'modifiche non salvate', 'ungespeicherte Änderungen', 'niet-opgeslagen wijzigingen', 'canvis sense desar', 'cambios sen gardar', 'gorde gabeko aldaketak'],
	['saved', 'saved', 'guardado', 'salvo', 'enregistré', 'salvato', 'gespeichert', 'opgeslagen', 'desat', 'gardado', 'gordeta'],
	['readOnly', 'read only', 'solo lectura', 'somente leitura', 'lecture seule', 'sola lettura', 'schreibgeschützt', 'alleen-lezen', 'només lectura', 'só lectura', 'irakurtzeko soilik'],
	['nothingSaved', 'Nothing saved yet', 'Todavía no hay nada guardado', 'Ainda não há nada salvo', "Rien d'enregistré pour l'instant", 'Ancora niente di salvato', 'Noch nichts gespeichert', 'Nog niets opgeslagen', 'Encara no hi ha res desat', 'Aínda non hai nada gardado', 'Oraindik ez dago ezer gordeta'],
	['openQuery', 'double click: query it', 'doble clic: consultar', 'duplo clique: consultar', 'double clic : interroger', 'doppio clic: interroga', 'Doppelklick: abfragen', 'dubbelklik: opvragen', 'doble clic: consulta', 'dobre clic: consultar', 'klik bikoitza: kontsultatu'],
	['properties', 'Properties', 'Propiedades', 'Propriedades', 'Propriétés', 'Proprietà', 'Eigenschaften', 'Eigenschappen', 'Propietats', 'Propiedades', 'Propietateak'],
	['relations', 'Relations', 'Relaciones', 'Relações', 'Relations', 'Relazioni', 'Beziehungen', 'Relaties', 'Relacions', 'Relacións', 'Erlazioak'],
	['keysIndexes', 'Keys and indexes', 'Claves e índices', 'Chaves e índices', 'Clés et index', 'Chiavi e indici', 'Schlüssel und Indizes', 'Sleutels en indexen', 'Claus i índexs', 'Claves e índices', 'Gakoak eta indizeak'],
	['data', 'Data', 'Datos', 'Dados', 'Données', 'Dati', 'Daten', 'Gegevens', 'Dades', 'Datos', 'Datuak'],
	['diagram', 'Diagram', 'Diagrama', 'Diagrama', 'Diagramme', 'Diagramma', 'Diagramm', 'Diagram', 'Diagrama', 'Diagrama', 'Diagrama'],
	['referencedBy', 'Referenced by', 'Referenciada por', 'Referenciada por', 'Référencée par', 'Referenziata da', 'Referenziert von', 'Verwezen door', 'Referenciada per', 'Referenciada por', 'Hauek erreferentziatzen dute'],
	['primaryKey', 'Primary key', 'Clave primaria', 'Chave primária', 'Clé primaire', 'Chiave primaria', 'Primärschlüssel', 'Primaire sleutel', 'Clau primària', 'Clave primaria', 'Gako nagusia'],
	['uniqueKey', 'Unique key', 'Clave única', 'Chave única', 'Clé unique', 'Chiave univoca', 'Eindeutiger Schlüssel', 'Unieke sleutel', 'Clau única', 'Clave única', 'Gako bakarra'],
	['indexes', 'Indexes', 'Índices', 'Índices', 'Index', 'Indici', 'Indizes', 'Indexen', 'Índexs', 'Índices', 'Indizeak'],
	['constraints', 'Constraints', 'Restricciones', 'Restrições', 'Contraintes', 'Vincoli', 'Einschränkungen', 'Beperkingen', 'Restriccions', 'Restricións', 'Murriztapenak'],
	['usesProperties', 'Properties it uses', 'Propiedades que usa', 'Propriedades que usa', 'Propriétés utilisées', 'Proprietà usate', 'Verwendete Eigenschaften', 'Gebruikte eigenschappen', 'Propietats que usa', 'Propiedades que usa', 'Erabiltzen dituen propietateak'],
	['validationsHint', 'Checked by λORM before each insert and update (after writeValue): a condition that is false rejects the sentence with its message.', 'λORM las comprueba antes de cada insert y update (después de writeValue): una condición falsa rechaza la sentencia con su mensaje.', 'O λORM as verifica antes de cada insert e update (depois do writeValue): uma condição falsa rejeita a sentença com sua mensagem.', 'λORM les vérifie avant chaque insert et update (après writeValue) : une condition fausse rejette la requête avec son message.', 'λORM le verifica prima di ogni insert e update (dopo writeValue): una condizione falsa rifiuta l’istruzione con il suo messaggio.', 'λORM prüft sie vor jedem Insert und Update (nach writeValue): eine falsche Bedingung weist die Anweisung mit ihrer Meldung ab.', 'λORM controleert ze vóór elke insert en update (na writeValue): een onware voorwaarde weigert de opdracht met haar melding.', 'λORM les comprova abans de cada insert i update (després de writeValue): una condició falsa rebutja la sentència amb el seu missatge.', 'λORM compróbaas antes de cada insert e update (despois de writeValue): unha condición falsa rexeita a sentenza coa súa mensaxe.', 'λORMek insert eta update bakoitzaren aurretik egiaztatzen ditu (writeValue ondoren): baldintza faltsu batek sententzia baztertzen du bere mezuarekin.'],
	['refresh', 'Refresh', 'Actualizar', 'Atualizar', 'Actualiser', 'Aggiorna', 'Aktualisieren', 'Vernieuwen', 'Actualitza', 'Actualizar', 'Freskatu'],
	['refreshOf', 'Refresh {name}: read again what changed elsewhere', 'Actualizar {name}: volver a leer lo que cambió en otro lado', 'Atualizar {name}: ler de novo o que mudou em outro lugar', 'Actualiser {name} : relire ce qui a changé ailleurs', 'Aggiorna {name}: rileggi ciò che è cambiato altrove', '{name} aktualisieren: neu lesen, was sich anderswo geändert hat', '{name} vernieuwen: opnieuw lezen wat elders veranderde', 'Actualitza {name}: torna a llegir el que ha canviat en un altre lloc', 'Actualizar {name}: volver ler o que cambiou noutro lado', '{name} freskatu: beste nonbait aldatutakoa berriro irakurri'],
	['helpReadExp', 'Replaces the column when reading: λORM translates it into the query (SQL) and the property returns its result. E.g. mask(email), concat(lastname,", ",firstname).', 'Reemplaza la columna al leer: λORM la traduce a la consulta (SQL) y la propiedad devuelve su resultado. Ej.: mask(email), concat(lastname,", ",firstname).', 'Substitui a coluna ao ler: o λORM a traduz para a consulta (SQL) e a propriedade devolve o seu resultado. Ex.: mask(email), concat(lastname,", ",firstname).', 'Remplace la colonne à la lecture : λORM la traduit dans la requête (SQL) et la propriété renvoie son résultat. Ex. : mask(email), concat(lastname,", ",firstname).', 'Sostituisce la colonna in lettura: λORM la traduce nella query (SQL) e la proprietà restituisce il suo risultato. Es.: mask(email), concat(lastname,", ",firstname).', 'Ersetzt die Spalte beim Lesen: λORM übersetzt sie in die Abfrage (SQL), und die Eigenschaft liefert ihr Ergebnis. Z. B. mask(email), concat(lastname,", ",firstname).', 'Vervangt de kolom bij het lezen: λORM vertaalt haar naar de query (SQL) en de eigenschap geeft haar resultaat. Bv. mask(email), concat(lastname,", ",firstname).', 'Substitueix la columna en llegir: λORM la tradueix a la consulta (SQL) i la propietat en retorna el resultat. P. ex.: mask(email), concat(lastname,", ",firstname).', 'Substitúe a columna ao ler: λORM tradúcea á consulta (SQL) e a propiedade devolve o seu resultado. P. ex.: mask(email), concat(lastname,", ",firstname).', 'Irakurtzean zutabea ordezten du: λORMek kontsultara (SQL) itzultzen du eta propietateak bere emaitza itzultzen du. Adib.: mask(email), concat(lastname,", ",firstname).'],
	['helpWriteExp', 'Meant for what is written in the column, but λORM 3.8 does not apply it: use writeValue.', 'Pensada para lo que se escribe en la columna, pero λORM 3.8 no la aplica: usa writeValue.', 'Pensada para o que se escreve na coluna, mas o λORM 3.8 não a aplica: use writeValue.', "Prévue pour ce qui est écrit dans la colonne, mais λORM 3.8 ne l'applique pas : utilisez writeValue.", 'Pensata per ciò che si scrive nella colonna, ma λORM 3.8 non la applica: usa writeValue.', 'Gedacht für das, was in die Spalte geschrieben wird, aber λORM 3.8 wendet sie nicht an: nutze writeValue.', 'Bedoeld voor wat in de kolom wordt geschreven, maar λORM 3.8 past haar niet toe: gebruik writeValue.', "Pensada per al que s'escriu a la columna, però λORM 3.8 no l'aplica: fes servir writeValue.", 'Pensada para o que se escribe na columna, pero λORM 3.8 non a aplica: usa writeValue.', 'Zutabean idazten denerako pentsatua, baina λORM 3.8k ez du aplikatzen: erabili writeValue.'],
	['helpReadValue', 'Transforms each value after reading it, in the gateway (not in the database). E.g. decrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor después de leerlo, en el gateway (no en la base de datos). Ej.: decrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor depois de lê-lo, no gateway (não no banco de dados). Ex.: decrypt(email,$DATA_SECRET_KEY).', 'Transforme chaque valeur après sa lecture, dans le gateway (pas dans la base de données). Ex. : decrypt(email,$DATA_SECRET_KEY).', 'Trasforma ogni valore dopo averlo letto, nel gateway (non nel database). Es.: decrypt(email,$DATA_SECRET_KEY).', 'Wandelt jeden Wert nach dem Lesen um, im Gateway (nicht in der Datenbank). Z. B. decrypt(email,$DATA_SECRET_KEY).', 'Zet elke waarde om na het lezen, in de gateway (niet in de database). Bv. decrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor després de llegir-lo, al gateway (no a la base de dades). P. ex.: decrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor despois de lelo, no gateway (non na base de datos). P. ex.: decrypt(email,$DATA_SECRET_KEY).', 'Balio bakoitza irakurri ondoren eraldatzen du, gatewayan (ez datu-basean). Adib.: decrypt(email,$DATA_SECRET_KEY).'],
	['helpWriteValue', 'Transforms each value before writing it (insert, update), in the gateway; the constraints see its result. E.g. encrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor antes de escribirlo (insert, update), en el gateway; las constraints ven su resultado. Ej.: encrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor antes de escrevê-lo (insert, update), no gateway; as constraints veem o seu resultado. Ex.: encrypt(email,$DATA_SECRET_KEY).', "Transforme chaque valeur avant de l'écrire (insert, update), dans le gateway ; les constraints voient son résultat. Ex. : encrypt(email,$DATA_SECRET_KEY).", 'Trasforma ogni valore prima di scriverlo (insert, update), nel gateway; le constraints vedono il suo risultato. Es.: encrypt(email,$DATA_SECRET_KEY).', 'Wandelt jeden Wert vor dem Schreiben um (Insert, Update), im Gateway; die Constraints sehen sein Ergebnis. Z. B. encrypt(email,$DATA_SECRET_KEY).', 'Zet elke waarde om vóór het schrijven (insert, update), in de gateway; de constraints zien het resultaat. Bv. encrypt(email,$DATA_SECRET_KEY).', "Transforma cada valor abans d'escriure'l (insert, update), al gateway; les constraints en veuen el resultat. P. ex.: encrypt(email,$DATA_SECRET_KEY).", 'Transforma cada valor antes de escribilo (insert, update), no gateway; as constraints ven o seu resultado. P. ex.: encrypt(email,$DATA_SECRET_KEY).', 'Balio bakoitza idatzi aurretik eraldatzen du (insert, update), gatewayan; constraintek bere emaitza ikusten dute. Adib.: encrypt(email,$DATA_SECRET_KEY).'],
	['type', 'Type', 'Tipo', 'Tipo', 'Type', 'Tipo', 'Typ', 'Type', 'Tipus', 'Tipo', 'Mota'],
	['length', 'Length', 'Largo', 'Tamanho', 'Longueur', 'Lunghezza', 'Länge', 'Lengte', 'Llargada', 'Lonxitude', 'Luzera'],
	['required', 'Required', 'Obligatoria', 'Obrigatória', 'Obligatoire', 'Obbligatoria', 'Pflicht', 'Verplicht', 'Obligatòria', 'Obrigatoria', 'Derrigorrezkoa'],
	['auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto'],
	['defaultValue', 'Default', 'Por defecto', 'Padrão', 'Par défaut', 'Predefinito', 'Standard', 'Standaard', 'Per defecte', 'Por defecto', 'Lehenetsia'],
	['references', 'References', 'Referencia a', 'Referencia', 'Référence', 'Riferimento', 'Verweist auf', 'Verwijst naar', 'Referència a', 'Referencia a', 'Erreferentzia'],
	['expressions', 'Expressions', 'Expresiones', 'Expressões', 'Expressions', 'Espressioni', 'Ausdrücke', 'Expressies', 'Expressions', 'Expresións', 'Adierazpenak'],
	['expression', 'Expression', 'Expresión', 'Expressão', 'Expression', 'Espressione', 'Ausdruck', 'Expressie', 'Expressió', 'Expresión', 'Adierazpena'],
	['expressionsOf', 'Expressions of {name}', 'Expresiones de {name}', 'Expressões de {name}', 'Expressions de {name}', 'Espressioni di {name}', 'Ausdrücke von {name}', 'Expressies van {name}', 'Expressions de {name}', 'Expresións de {name}', '{name}(r)en adierazpenak'],
	['entity', 'Entity', 'Entidad', 'Entidade', 'Entité', 'Entità', 'Entität', 'Entiteit', 'Entitat', 'Entidade', 'Entitatea'],
	['from', 'From', 'Desde', 'De', 'De', 'Da', 'Von', 'Van', 'Des de', 'Desde', 'Nondik'],
	['to', 'To', 'Hasta', 'Para', 'Vers', 'A', 'Nach', 'Naar', 'Fins a', 'Ata', 'Nora'],
	['cardinality', 'Cardinality', 'Cardinalidad', 'Cardinalidade', 'Cardinalité', 'Cardinalità', 'Kardinalität', 'Kardinaliteit', 'Cardinalitat', 'Cardinalidade', 'Kardinaltasuna'],
	['weak', 'Weak', 'Débil', 'Fraca', 'Faible', 'Debole', 'Schwach', 'Zwak', 'Feble', 'Débil', 'Ahula'],
	['fields', 'Fields', 'Campos', 'Campos', 'Champs', 'Campi', 'Felder', 'Velden', 'Camps', 'Campos', 'Eremuak'],
	['message', 'Message', 'Mensaje', 'Mensagem', 'Message', 'Messaggio', 'Meldung', 'Bericht', 'Missatge', 'Mensaxe', 'Mezua'],
	['condition', 'Condition', 'Condición', 'Condição', 'Condition', 'Condizione', 'Bedingung', 'Voorwaarde', 'Condició', 'Condición', 'Baldintza'],
	['queryIt', 'Query', 'Consultar', 'Consultar', 'Interroger', 'Interroga', 'Abfragen', 'Opvragen', 'Consulta', 'Consultar', 'Kontsultatu'],
	['previous', 'Previous', 'Anterior', 'Anterior', 'Précédente', 'Precedente', 'Zurück', 'Vorige', 'Anterior', 'Anterior', 'Aurrekoa'],
	['next', 'Next', 'Siguiente', 'Próxima', 'Suivante', 'Successiva', 'Weiter', 'Volgende', 'Següent', 'Seguinte', 'Hurrengoa'],
	['page', 'Page {n}', 'Página {n}', 'Página {n}', 'Page {n}', 'Pagina {n}', 'Seite {n}', 'Pagina {n}', 'Pàgina {n}', 'Páxina {n}', '{n}. orria'],
	['none', 'none', 'ninguno', 'nenhum', 'aucun', 'nessuno', 'keine', 'geen', 'cap', 'ningún', 'bat ere ez'],
	['abstract', 'abstract', 'abstracta', 'abstrata', 'abstraite', 'astratta', 'abstrakt', 'abstract', 'abstracta', 'abstracta', 'abstraktua'],
	['viewEntity', 'view', 'vista', 'visão', 'vue', 'vista', 'Sicht', 'view', 'vista', 'vista', 'ikuspegia'],
	['extendsEntity', 'extends {name}', 'extiende {name}', 'estende {name}', 'étend {name}', 'estende {name}', 'erweitert {name}', 'breidt {name} uit', 'estén {name}', 'estende {name}', '{name} hedatzen du'],
	['openEntity', 'double click: open its form', 'doble clic: abrir su formulario', 'duplo clique: abrir o formulário', 'double clic : ouvrir son formulaire', 'doppio clic: apri la scheda', 'Doppelklick: Formular öffnen', 'dubbelklik: formulier openen', 'doble clic: obre el formulari', 'dobre clic: abrir o formulario', 'klik bikoitza: ireki inprimakia'],
	['readOnlyData', 'Read only: rows are not changed here.', 'Solo lectura: acá no se modifican filas.', 'Somente leitura: aqui não se alteram linhas.', 'Lecture seule : les lignes ne sont pas modifiées ici.', 'Sola lettura: qui non si modificano righe.', 'Nur lesen: Zeilen werden hier nicht geändert.', 'Alleen-lezen: rijen worden hier niet gewijzigd.', 'Només lectura: aquí no es modifiquen files.', 'Só lectura: aquí non se modifican filas.', 'Irakurtzeko soilik: hemen ez dira errenkadak aldatzen.'],
	['dataEditHint', 'Double click a cell to change it (Enter saves, Esc cancels).', 'Doble clic en una celda para cambiarla (Enter guarda, Esc cancela).', 'Clique duas vezes numa célula para alterá-la (Enter salva, Esc cancela).', 'Double-cliquez sur une cellule pour la modifier (Entrée enregistre, Échap annule).', 'Doppio clic su una cella per modificarla (Invio salva, Esc annulla).', 'Doppelklick auf eine Zelle, um sie zu ändern (Enter speichert, Esc bricht ab).', 'Dubbelklik op een cel om die te wijzigen (Enter bewaart, Esc annuleert).', 'Doble clic en una cel·la per canviar-la (Enter desa, Esc cancel·la).', 'Dobre clic nunha cela para cambiala (Enter garda, Esc cancela).', 'Klik bikoitza gelaxka batean aldatzeko (Enter gordetzen du, Esc bertan behera uzten du).'],
	['dataNoKey', 'Read only: the entity has no primary key.', 'Solo lectura: la entidad no tiene clave primaria.', 'Somente leitura: a entidade não tem chave primária.', 'Lecture seule : l’entité n’a pas de clé primaire.', 'Sola lettura: l’entità non ha una chiave primaria.', 'Nur lesen: die Entität hat keinen Primärschlüssel.', 'Alleen-lezen: de entiteit heeft geen primaire sleutel.', 'Només lectura: l’entitat no té clau primària.', 'Só lectura: a entidade non ten clave primaria.', 'Irakurtzeko soilik: entitateak ez du gako nagusirik.'],
	['addRow', 'Add a row', 'Agregar una fila', 'Adicionar uma linha', 'Ajouter une ligne', 'Aggiungi una riga', 'Zeile hinzufügen', 'Rij toevoegen', 'Afegeix una fila', 'Engadir unha fila', 'Gehitu errenkada bat'],
	['deleteRow', 'Delete the row', 'Borrar la fila', 'Excluir a linha', 'Supprimer la ligne', 'Elimina la riga', 'Zeile löschen', 'Rij verwijderen', 'Esborra la fila', 'Borrar a fila', 'Ezabatu errenkada'],
	['confirmDeleteRow', 'Delete this row? It can’t be undone.', '¿Borrar esta fila? No se puede deshacer.', 'Excluir esta linha? Não pode ser desfeito.', 'Supprimer cette ligne ? C’est irréversible.', 'Eliminare questa riga? Non si può annullare.', 'Diese Zeile löschen? Das kann nicht rückgängig gemacht werden.', 'Deze rij verwijderen? Dit kan niet ongedaan worden.', 'Esborrar aquesta fila? No es pot desfer.', 'Borrar esta fila? Non se pode desfacer.', 'Errenkada hau ezabatu? Ezin da desegin.'],
	['changedMeanwhile', 'Someone changed it meanwhile: the table shows it now.', 'Alguien la cambió mientras tanto: la tabla la muestra ahora.', 'Alguém a alterou nesse meio-tempo: a tabela a mostra agora.', 'Quelqu’un l’a modifiée entre-temps : le tableau l’affiche maintenant.', 'Qualcuno l’ha cambiata nel frattempo: la tabella ora la mostra.', 'Jemand hat sie inzwischen geändert: die Tabelle zeigt sie jetzt.', 'Iemand heeft het intussen gewijzigd: de tabel toont het nu.', 'Algú l’ha canviada mentrestant: la taula la mostra ara.', 'Alguén a cambiou mentres tanto: a táboa móstraa agora.', 'Norbaitek aldatu du bitartean: taulak orain erakusten du.'],
	['rowFilter', 'filter (on p)', 'filtro (sobre p)', 'filtro (sobre p)', 'filtre (sur p)', 'filtro (su p)', 'Filter (auf p)', 'filter (op p)', 'filtre (sobre p)', 'filtro (sobre p)', 'iragazkia (p-ren gainean)'],
	['applyFilter', 'Apply', 'Aplicar', 'Aplicar', 'Appliquer', 'Applica', 'Anwenden', 'Toepassen', 'Aplica', 'Aplicar', 'Aplikatu'],
	['exportPage', 'Export the page', 'Exportar la página', 'Exportar a página', 'Exporter la page', 'Esporta la pagina', 'Seite exportieren', 'Pagina exporteren', 'Exporta la pàgina', 'Exportar a páxina', 'Esportatu orria'],
	['exportAll', 'Export all', 'Exportar todo', 'Exportar tudo', 'Tout exporter', 'Esporta tutto', 'Alles exportieren', 'Alles exporteren', 'Exporta-ho tot', 'Exportar todo', 'Esportatu dena'],
	['exportingRows', 'Exporting… {n} rows', 'Exportando… {n} filas', 'Exportando… {n} linhas', 'Export… {n} lignes', 'Esportazione… {n} righe', 'Export… {n} Zeilen', 'Exporteren… {n} rijen', 'Exportant… {n} files', 'Exportando… {n} filas', 'Esportatzen… {n} errenkada'],
	['longitude', 'Longitude', 'Longitud', 'Longitude', 'Longitude', 'Longitudine', 'Längengrad', 'Lengtegraad', 'Longitud', 'Lonxitude', 'Longitudea'],
	['latitude', 'Latitude', 'Latitud', 'Latitude', 'Latitude', 'Latitudine', 'Breitengrad', 'Breedtegraad', 'Latitud', 'Latitude', 'Latitudea'],
	['onMap', 'See it on a map', 'Verlo en un mapa', 'Ver no mapa', 'Voir sur une carte', 'Vedi sulla mappa', 'Auf einer Karte zeigen', 'Bekijk op een kaart', 'Veure-ho en un mapa', 'Velo nun mapa', 'Ikusi mapan'],
	['vectorHint', 'a list of {n} numbers: [0.1, 0.2, …]', 'una lista de {n} números: [0.1, 0.2, …]', 'uma lista de {n} números: [0.1, 0.2, …]', 'une liste de {n} nombres : [0.1, 0.2, …]', 'un elenco di {n} numeri: [0.1, 0.2, …]', 'eine Liste von {n} Zahlen: [0.1, 0.2, …]', 'een lijst van {n} getallen: [0.1, 0.2, …]', 'una llista de {n} nombres: [0.1, 0.2, …]', 'unha lista de {n} números: [0.1, 0.2, …]', '{n} zenbakiko zerrenda: [0.1, 0.2, …]'],
	['exportLimit', 'Only the first {n} rows: narrow it with a filter.', 'Solo las primeras {n} filas: acótelo con un filtro.', 'Só as primeiras {n} linhas: restrinja com um filtro.', 'Seulement les {n} premières lignes : réduisez avec un filtre.', 'Solo le prime {n} righe: restringi con un filtro.', 'Nur die ersten {n} Zeilen: mit einem Filter eingrenzen.', 'Alleen de eerste {n} rijen: beperk met een filter.', 'Només les primeres {n} files: acoteu-ho amb un filtre.', 'Só as primeiras {n} filas: acoteo cun filtro.', 'Lehen {n} errenkadak soilik: mugatu iragazki batekin.'],
	['search', 'search…', 'buscar…', 'buscar…', 'rechercher…', 'cerca…', 'suchen…', 'zoeken…', 'cerca…', 'buscar…', 'bilatu…'],
	['addNeighbours', 'Add their neighbours', 'Agregar sus vecinas', 'Adicionar as vizinhas', 'Ajouter leurs voisines', 'Aggiungi le vicine', 'Nachbarn hinzufügen', 'Buren toevoegen', 'Afegeix les veïnes', 'Engadir as veciñas', 'Gehitu auzokideak'],
	['clearSelection', 'Clear', 'Limpiar', 'Limpar', 'Effacer', 'Pulisci', 'Leeren', 'Wissen', 'Neteja', 'Limpar', 'Garbitu'],
	['selectedCount', '{n} selected', '{n} seleccionadas', '{n} selecionadas', '{n} sélectionnées', '{n} selezionate', '{n} ausgewählt', '{n} geselecteerd', '{n} seleccionades', '{n} seleccionadas', '{n} hautatuta'],
	['chooseEntities', 'Choose at least one entity.', 'Elegí al menos una entidad.', 'Escolha pelo menos uma entidade.', 'Choisissez au moins une entité.', 'Scegli almeno un’entità.', 'Wähle mindestens eine Entität.', 'Kies minstens één entiteit.', 'Tria almenys una entitat.', 'Escolle polo menos unha entidade.', 'Aukeratu entitate bat gutxienez.'],
	['editEntities', 'Entities…', 'Entidades…', 'Entidades…', 'Entités…', 'Entità…', 'Entitäten…', 'Entiteiten…', 'Entitats…', 'Entidades…', 'Entitateak…'],
	['saveDiagram', 'Save the diagram', 'Guardar el diagrama', 'Salvar o diagrama', 'Enregistrer le diagramme', 'Salva il diagramma', 'Diagramm speichern', 'Diagram opslaan', 'Desa el diagrama', 'Gardar o diagrama', 'Gorde diagrama'],
	['nothingOpen', 'Open a query, an entity or a diagram from the explorer, or start a query with +.', 'Abrí una consulta, una entidad o un diagrama desde el explorador, o empezá una consulta con +.', 'Abra uma consulta, uma entidade ou um diagrama no explorador, ou comece uma consulta com +.', "Ouvrez une requête, une entité ou un diagramme depuis l'explorateur, ou commencez une requête avec +.", "Apri una query, un'entità o un diagramma dall'esplora, o inizia una query con +.", 'Öffne eine Abfrage, eine Entität oder ein Diagramm im Explorer oder beginne eine Abfrage mit +.', 'Open een query, een entiteit of een diagram vanuit de verkenner, of begin een query met +.', "Obre una consulta, una entitat o un diagrama des de l'explorador, o comença una consulta amb +.", 'Abre unha consulta, unha entidade ou un diagrama desde o explorador, ou comeza unha consulta con +.', 'Ireki kontsulta, entitate edo diagrama bat arakatzailetik, edo hasi kontsulta bat + erabiliz.'],
	['open', 'Open', 'Abrir', 'Abrir', 'Ouvrir', 'Apri', 'Öffnen', 'Openen', 'Obre', 'Abrir', 'Ireki'],
	['filterEntities', 'Filter: entity, property, Entity.field', 'Filtrar: entidad, propiedad, Entidad.campo', 'Filtrar: entidade, propriedade, Entidade.campo', 'Filtrer : entité, propriété, Entité.champ', 'Filtra: entità, proprietà, Entità.campo', 'Filtern: Entität, Eigenschaft, Entität.Feld', 'Filteren: entiteit, eigenschap, Entiteit.veld', 'Filtra: entitat, propietat, Entitat.camp', 'Filtrar: entidade, propiedade, Entidade.campo', 'Iragazi: entitatea, propietatea, Entitatea.eremua'],
	['matchesOf', '{n} of {total}', '{n} de {total}', '{n} de {total}', '{n} sur {total}', '{n} di {total}', '{n} von {total}', '{n} van {total}', '{n} de {total}', '{n} de {total}', '{n} / {total}'],
	['noMatches', 'Nothing matches', 'Nada coincide', 'Nada corresponde', 'Aucun résultat', 'Nessun risultato', 'Keine Treffer', 'Geen resultaten', 'No hi ha coincidències', 'Nada coincide', 'Ez dago bat-etortzerik'],
	['resizeExplorer', 'Drag to resize; double click fits the names', 'Arrastrá para cambiar el ancho; doble clic lo ajusta a los nombres', 'Arraste para mudar a largura; clique duplo ajusta aos nomes', 'Faites glisser pour redimensionner ; un double clic ajuste aux noms', 'Trascina per ridimensionare; doppio clic per adattare ai nomi', 'Ziehen zum Ändern der Breite; Doppelklick passt sie an die Namen an', 'Sleep om de breedte te wijzigen; dubbelklik past aan de namen', 'Arrossega per canviar l’amplada; doble clic l’ajusta als noms', 'Arrastra para cambiar o largo; dobre clic axústao aos nomes', 'Arrastatu zabalera aldatzeko; klik bikoitzak izenetara egokitzen du'],
	['schemaStatus', '({status})', '({status})', '({status})', '({status})', '({status})', '({status})', '({status})', '({status})', '({status})', '({status})'],
	['schemaPending', 'A new version did not start; the previous one is serving', 'Una versión nueva no arrancó; atiende la anterior', 'Uma versão nova não iniciou; a anterior está atendendo', 'Une nouvelle version n’a pas démarré ; la précédente répond', 'Una nuova versione non è partita; risponde la precedente', 'Eine neue Version ist nicht gestartet; die vorherige antwortet', 'Een nieuwe versie is niet gestart; de vorige antwoordt', 'Una versió nova no ha arrencat; respon l’anterior', 'Unha versión nova non arrincou; atende a anterior', 'Bertsio berri bat ez da abiatu; aurrekoak erantzuten du'],
	['noReason', 'The gateway gives no reason: see its log.', 'La gateway no da el motivo: mirá su log.', 'A gateway não informa o motivo: veja o log.', 'La passerelle ne donne pas la raison : voyez son journal.', 'Il gateway non indica il motivo: guarda il suo log.', 'Das Gateway nennt keinen Grund: siehe sein Log.', 'De gateway geeft geen reden: bekijk het log.', 'La passarel·la no en dona el motiu: mira’n el registre.', 'A pasarela non dá o motivo: mira o seu rexistro.', 'Pasabideak ez du arrazoia ematen: begiratu bere erregistroa.']
]

const ORDER: Locale[] = ['en', 'es', 'pt', 'fr', 'it', 'de', 'nl', 'ca', 'gl', 'eu']

const BY_LOCALE = Object.fromEntries(ORDER.map((locale, i) => [locale, Object.fromEntries(ROWS.map(row => [row[0], row[i + 1]])) as unknown as ExplorerMessages])) as Record<Locale, ExplorerMessages>

export const explorerMessagesOf = (locale: string | undefined): ExplorerMessages =>
	BY_LOCALE[locale as Locale] ?? BY_LOCALE[(locale ?? '').slice(0, 2) as Locale] ?? BY_LOCALE.en

export { format }
