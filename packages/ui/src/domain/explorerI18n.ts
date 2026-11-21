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
	type: string
	length: string
	required: string
	auto: string
	defaultValue: string
	references: string
	expressions: string
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
	['type', 'Type', 'Tipo', 'Tipo', 'Type', 'Tipo', 'Typ', 'Type', 'Tipus', 'Tipo', 'Mota'],
	['length', 'Length', 'Largo', 'Tamanho', 'Longueur', 'Lunghezza', 'Länge', 'Lengte', 'Llargada', 'Lonxitude', 'Luzera'],
	['required', 'Required', 'Obligatoria', 'Obrigatória', 'Obligatoire', 'Obbligatoria', 'Pflicht', 'Verplicht', 'Obligatòria', 'Obrigatoria', 'Derrigorrezkoa'],
	['auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto', 'Auto'],
	['defaultValue', 'Default', 'Por defecto', 'Padrão', 'Par défaut', 'Predefinito', 'Standard', 'Standaard', 'Per defecte', 'Por defecto', 'Lehenetsia'],
	['references', 'References', 'Referencia a', 'Referencia', 'Référence', 'Riferimento', 'Verweist auf', 'Verwijst naar', 'Referència a', 'Referencia a', 'Erreferentzia'],
	['expressions', 'Expressions', 'Expresiones', 'Expressões', 'Expressions', 'Espressioni', 'Ausdrücke', 'Expressies', 'Expressions', 'Expresións', 'Adierazpenak'],
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
	['noMatches', 'Nothing matches', 'Nada coincide', 'Nada corresponde', 'Aucun résultat', 'Nessun risultato', 'Keine Treffer', 'Geen resultaten', 'No hi ha coincidències', 'Nada coincide', 'Ez dago bat-etortzerik']
]

const ORDER: Locale[] = ['en', 'es', 'pt', 'fr', 'it', 'de', 'nl', 'ca', 'gl', 'eu']

const BY_LOCALE = Object.fromEntries(ORDER.map((locale, i) => [locale, Object.fromEntries(ROWS.map(row => [row[0], row[i + 1]])) as unknown as ExplorerMessages])) as Record<Locale, ExplorerMessages>

export const explorerMessagesOf = (locale: string | undefined): ExplorerMessages =>
	BY_LOCALE[locale as Locale] ?? BY_LOCALE[(locale ?? '').slice(0, 2) as Locale] ?? BY_LOCALE.en

export { format }
