/** The languages the components speak */
export type Locale = 'en' | 'es' | 'pt' | 'fr' | 'it' | 'de' | 'nl' | 'ca' | 'gl' | 'eu'

/** Each language with its own name, for a selector */
export const LOCALES: { code: Locale, name: string }[] = [
	{ code: 'en', name: 'English' },
	{ code: 'es', name: 'Español' },
	{ code: 'pt', name: 'Português' },
	{ code: 'fr', name: 'Français' },
	{ code: 'it', name: 'Italiano' },
	{ code: 'de', name: 'Deutsch' },
	{ code: 'nl', name: 'Nederlands' },
	{ code: 'ca', name: 'Català' },
	{ code: 'gl', name: 'Galego' },
	{ code: 'eu', name: 'Euskara' }
]

/** The texts of the components; {name} is replaced. Operation names (plan, execute…) are the API's and stay as they are. */
export interface Messages {
	schema: string
	choose: string
	mode: string
	query: string
	script: string
	data: string
	options: string
	topic: string
	chunk: string
	runShortcut: string
	history: string
	clearHistory: string
	runToSee: string
	useName: string
	didYouMean: string
	rows: string
	copy: string
	copied: string
	/** the tabs of a result (json and yaml are names) */
	viewTree: string
	viewTable: string
	export: string
	tsv: string
	showing: string
	reasonNoCredential: string
	reasonScriptsDisabled: string
	reasonNoPermission: string
	noticeNoSchema: string
	noticeCredential: string
	newTab: string
	tabNamed: string
	close: string
	tabLimit: string
	tabName: string
	model: string
	entity: string
	depth1: string
	depth2: string
	wholeModel: string
	namesOnly: string
	fit: string
	summary: string
	loadingModel: string
	noDomain: string
	diagramHint: string
	relayout: string
	diagramEditHint: string
	relationNames: string
	detail: string
	detailAll: string
	detailKeys: string
	detailPk: string
	detailName: string
	addRelated: string
	relatedTitle: string
	addChosen: string
	allNone: string
	cancelAdd: string
	exportAs: string
	toolSelect: string
	toolMove: string
	zoomIn: string
	zoomOut: string
	removeSelected: string
	copyQuery: string
	formatQueryText: string
	copiedQuery: string
	diagramQuery: string
	selectHint: string
	removeFromDiagram: string
	/** the whole diagram small, with what the view shows: shown or hidden */
	outline: string
}

const en: Messages = {
	schema: 'schema', choose: 'choose…', mode: 'mode', query: 'query', script: 'script', data: 'data', options: 'options', topic: 'topic', chunk: 'chunk',
	viewTree: 'tree', viewTable: 'table', runShortcut: 'Ctrl+Enter', history: 'history', clearHistory: 'clear history', runToSee: 'Run an action to see its result.', useName: 'use {name}', didYouMean: 'Did you mean', rows: '{n} rows', copy: 'copy', copied: 'copied', export: 'export', tsv: 'TXT (tab-separated)',
	showing: 'Showing {shown} of {total} rows: the downloads have all of them.',
	reasonNoCredential: 'no credential yet', reasonScriptsDisabled: 'scripts are disabled on this schema',
	reasonNoPermission: '"{name}" has no {permission} permission', noticeNoSchema: 'no schema is ready',
	noticeCredential: 'the credential is not valid for this schema', newTab: 'new tab', tabNamed: 'Query', close: 'close', tabLimit: 'at most {n} tabs', tabName: 'tab name', model: 'Model', entity: 'entity', depth1: 'neighbours', depth2: '2 levels', wholeModel: 'whole model', namesOnly: 'names only', fit: 'fit', summary: 'entities: {entities} · relations: {relations}', loadingModel: 'Drawing the model…', noDomain: 'this gateway gives no domain', diagramHint: 'click: center on it · double click: query it · wheel: zoom · drag: move', relayout: 'lay out again', diagramEditHint: 'drag a box or a line: move it · double click on a line: put it back · on a box: open it · × or Delete: remove the box · wheel: zoom · drag the background: move', relationNames: 'relation names', detail: 'show', detailAll: 'all properties', detailKeys: 'keys (PK and FK)', detailPk: 'primary key', detailName: 'table name only', addRelated: 'add the related tables', relatedTitle: 'Related tables of {name} not in the diagram', addChosen: 'add', allNone: 'all / none', cancelAdd: 'cancel', exportAs: 'export', toolSelect: 'select', toolMove: 'move', zoomIn: 'zoom in', zoomOut: 'zoom out', removeSelected: 'remove the selected ({n})', copyQuery: 'copy the query', formatQueryText: 'format the query', copiedQuery: 'copied', diagramQuery: 'query of the diagram: its data', selectHint: 'Shift/Ctrl+click or Shift+drag the background: select several (drag one to move them, Delete to remove them) · Ctrl+A: all · Esc: none', removeFromDiagram: 'remove from the diagram', outline: 'outline: the whole diagram'
}

const MESSAGES: Record<Locale, Messages> = {
	en,
	es: {
		schema: 'esquema', choose: 'elegir…', mode: 'modo', query: 'consulta', script: 'script', data: 'datos', options: 'opciones', topic: 'tópico', chunk: 'lote',
		viewTree: 'árbol', viewTable: 'tabla', runShortcut: 'Ctrl+Enter', history: 'historial', clearHistory: 'borrar historial', runToSee: 'Ejecutá una acción para ver su resultado.', useName: 'usar {name}', didYouMean: '¿Quisiste decir', rows: '{n} filas', copy: 'copiar', copied: 'copiado', export: 'exportar', tsv: 'TXT (separado por tabulaciones)',
		showing: 'Se muestran {shown} de {total} filas: las descargas tienen todas.',
		reasonNoCredential: 'todavía no hay credencial', reasonScriptsDisabled: 'los scripts están deshabilitados en este esquema',
		reasonNoPermission: '"{name}" no tiene el permiso {permission}', noticeNoSchema: 'ningún esquema está listo',
		noticeCredential: 'la credencial no es válida para este esquema', newTab: 'nueva pestaña', tabNamed: 'Consulta', close: 'cerrar', tabLimit: 'como máximo {n} pestañas', tabName: 'nombre de la pestaña', model: 'Modelo', entity: 'entidad', depth1: 'vecinas', depth2: '2 niveles', wholeModel: 'todo el modelo', namesOnly: 'solo nombres', fit: 'ajustar', summary: 'entidades: {entities} · relaciones: {relations}', loadingModel: 'Dibujando el modelo…', noDomain: 'este gateway no da el dominio', diagramHint: 'clic: centrar · doble clic: consultar · rueda: zoom · arrastrar: mover', relayout: 'acomodar de nuevo', diagramEditHint: 'arrastrar una caja o una línea: moverla · doble clic en una línea: volverla a su lugar · en una caja: abrirla · × o Supr: quitar la caja · rueda: zoom · arrastrar el fondo: mover', relationNames: 'nombres de relaciones', detail: 'mostrar', detailAll: 'todas las propiedades', detailKeys: 'claves (PK y FK)', detailPk: 'clave primaria', detailName: 'solo el nombre de la tabla', addRelated: 'agregar las tablas relacionadas', relatedTitle: 'Tablas relacionadas con {name} que no están en el diagrama', addChosen: 'agregar', allNone: 'todas / ninguna', cancelAdd: 'cancelar', exportAs: 'exportar', toolSelect: 'seleccionar', toolMove: 'mover', zoomIn: 'acercar', zoomOut: 'alejar', removeSelected: 'quitar las seleccionadas ({n})', copyQuery: 'copiar la consulta', formatQueryText: 'formatear la consulta', copiedQuery: 'copiada', diagramQuery: 'consulta del diagrama: sus datos', selectHint: 'Shift/Ctrl+clic o Shift+arrastrar el fondo: seleccionar varias (arrastrá una para moverlas, Supr para quitarlas) · Ctrl+A: todas · Esc: ninguna', removeFromDiagram: 'quitar del diagrama', outline: 'outline: el diagrama completo'
	},
	pt: {
		schema: 'esquema', choose: 'escolher…', mode: 'modo', query: 'consulta', script: 'script', data: 'dados', options: 'opções', topic: 'tópico', chunk: 'lote',
		viewTree: 'árvore', viewTable: 'tabela', runShortcut: 'Ctrl+Enter', history: 'histórico', clearHistory: 'limpar histórico', runToSee: 'Execute uma ação para ver o resultado.', useName: 'usar {name}', didYouMean: 'Você quis dizer', rows: '{n} linhas', copy: 'copiar', copied: 'copiado', export: 'exportar', tsv: 'TXT (separado por tabulações)',
		showing: 'Mostrando {shown} de {total} linhas: os downloads têm todas.',
		reasonNoCredential: 'ainda sem credencial', reasonScriptsDisabled: 'os scripts estão desativados neste esquema',
		reasonNoPermission: '"{name}" não tem a permissão {permission}', noticeNoSchema: 'nenhum esquema está pronto',
		noticeCredential: 'a credencial não é válida para este esquema', newTab: 'nova aba', tabNamed: 'Consulta', close: 'fechar', tabLimit: 'no máximo {n} abas', tabName: 'nome da aba', model: 'Modelo', entity: 'entidade', depth1: 'vizinhas', depth2: '2 níveis', wholeModel: 'modelo inteiro', namesOnly: 'só nomes', fit: 'ajustar', summary: 'entidades: {entities} · relações: {relations}', loadingModel: 'Desenhando o modelo…', noDomain: 'este gateway não fornece o domínio', diagramHint: 'clique: centralizar · duplo clique: consultar · roda: zoom · arrastar: mover', relayout: 'reorganizar', diagramEditHint: 'arrastar uma caixa: movê-la · duplo clique: abri-la · roda: zoom · arrastar o fundo: mover', relationNames: 'nomes das relações', detail: 'mostrar', detailAll: 'todas as propriedades', detailKeys: 'chaves (PK e FK)', detailPk: 'chave primária', detailName: 'só o nome da tabela', addRelated: 'adicionar as tabelas relacionadas', relatedTitle: 'Tabelas relacionadas com {name} que não estão no diagrama', addChosen: 'adicionar', allNone: 'todas / nenhuma', cancelAdd: 'cancelar', exportAs: 'exportar', toolSelect: 'selecionar', toolMove: 'mover', zoomIn: 'aproximar', zoomOut: 'afastar', removeSelected: 'remover as selecionadas ({n})', copyQuery: 'copiar a consulta', formatQueryText: 'formatar a consulta', copiedQuery: 'copiada', diagramQuery: 'consulta do diagrama: seus dados', selectHint: 'Shift/Ctrl+clique ou Shift+arrastar o fundo: selecionar várias (arraste uma para movê-las, Delete para removê-las) · Ctrl+A: todas · Esc: nenhuma', removeFromDiagram: 'tirar do diagrama', outline: 'outline: o diagrama completo'
	},
	fr: {
		schema: 'schéma', choose: 'choisir…', mode: 'mode', query: 'requête', script: 'script', data: 'données', options: 'options', topic: 'topic', chunk: 'lot',
		viewTree: 'arbre', viewTable: 'tableau', runShortcut: 'Ctrl+Entrée', history: 'historique', clearHistory: "effacer l'historique", runToSee: 'Lancez une action pour voir son résultat.', useName: 'utiliser {name}', didYouMean: 'Vouliez-vous dire', rows: '{n} lignes', copy: 'copier', copied: 'copié', export: 'exporter', tsv: 'TXT (séparé par des tabulations)',
		showing: 'Affichage de {shown} lignes sur {total} : les téléchargements les contiennent toutes.',
		reasonNoCredential: "pas encore d'identifiant", reasonScriptsDisabled: 'les scripts sont désactivés sur ce schéma',
		reasonNoPermission: "« {name} » n'a pas la permission {permission}", noticeNoSchema: "aucun schéma n'est prêt",
		noticeCredential: "l'identifiant n'est pas valide pour ce schéma", newTab: 'nouvel onglet', tabNamed: 'Requête', close: 'fermer', tabLimit: '{n} onglets au maximum', tabName: "nom de l'onglet", model: 'Modèle', entity: 'entité', depth1: 'voisines', depth2: '2 niveaux', wholeModel: 'modèle entier', namesOnly: 'noms seulement', fit: 'ajuster', summary: 'entités : {entities} · relations : {relations}', loadingModel: 'Dessin du modèle…', noDomain: 'cette passerelle ne fournit pas le domaine', diagramHint: 'clic : centrer · double clic : interroger · molette : zoom · glisser : déplacer', relayout: 'réorganiser', diagramEditHint: 'glisser une boîte : la déplacer · double clic : l’ouvrir · molette : zoom · glisser le fond : déplacer', relationNames: 'noms des relations', detail: 'afficher', detailAll: 'toutes les propriétés', detailKeys: 'clés (PK et FK)', detailPk: 'clé primaire', detailName: 'nom de la table seulement', addRelated: 'ajouter les tables liées', relatedTitle: 'Tables liées à {name} absentes du diagramme', addChosen: 'ajouter', allNone: 'toutes / aucune', cancelAdd: 'annuler', exportAs: 'exporter', toolSelect: 'sélectionner', toolMove: 'déplacer', zoomIn: 'zoom avant', zoomOut: 'zoom arrière', removeSelected: 'retirer la sélection ({n})', copyQuery: 'copier la requête', formatQueryText: 'mettre en forme la requête', copiedQuery: 'copiée', diagramQuery: 'requête du diagramme : ses données', selectHint: 'Maj/Ctrl+clic ou Maj+glisser le fond : en sélectionner plusieurs (glissez-en une pour les déplacer, Suppr pour les retirer) · Ctrl+A : toutes · Échap : aucune', removeFromDiagram: 'retirer du diagramme', outline: 'aperçu : le diagramme entier'
	},
	it: {
		schema: 'schema', choose: 'scegli…', mode: 'modalità', query: 'query', script: 'script', data: 'dati', options: 'opzioni', topic: 'topic', chunk: 'blocco',
		viewTree: 'albero', viewTable: 'tabella', runShortcut: 'Ctrl+Invio', history: 'cronologia', clearHistory: 'cancella cronologia', runToSee: "Esegui un'azione per vederne il risultato.", useName: 'usa {name}', didYouMean: 'Intendevi', rows: '{n} righe', copy: 'copia', copied: 'copiato', export: 'esporta', tsv: 'TXT (separato da tabulazioni)',
		showing: 'Mostrate {shown} di {total} righe: i download le contengono tutte.',
		reasonNoCredential: 'ancora nessuna credenziale', reasonScriptsDisabled: 'gli script sono disattivati in questo schema',
		reasonNoPermission: '"{name}" non ha il permesso {permission}', noticeNoSchema: 'nessuno schema è pronto',
		noticeCredential: 'la credenziale non è valida per questo schema', newTab: 'nuova scheda', tabNamed: 'Query', close: 'chiudi', tabLimit: 'al massimo {n} schede', tabName: 'nome della scheda', model: 'Modello', entity: 'entità', depth1: 'vicine', depth2: '2 livelli', wholeModel: 'modello intero', namesOnly: 'solo nomi', fit: 'adatta', summary: 'entità: {entities} · relazioni: {relations}', loadingModel: 'Disegno del modello…', noDomain: 'questo gateway non fornisce il dominio', diagramHint: 'clic: centra · doppio clic: interroga · rotellina: zoom · trascina: sposta', relayout: 'riorganizza', diagramEditHint: 'trascina un riquadro: spostalo · doppio clic: aprilo · rotellina: zoom · trascina lo sfondo: sposta', relationNames: 'nomi delle relazioni', detail: 'mostra', detailAll: 'tutte le proprietà', detailKeys: 'chiavi (PK e FK)', detailPk: 'chiave primaria', detailName: 'solo il nome della tabella', addRelated: 'aggiungi le tabelle correlate', relatedTitle: 'Tabelle correlate a {name} non presenti nel diagramma', addChosen: 'aggiungi', allNone: 'tutte / nessuna', cancelAdd: 'annulla', exportAs: 'esporta', toolSelect: 'seleziona', toolMove: 'sposta', zoomIn: 'ingrandisci', zoomOut: 'riduci', removeSelected: 'rimuovi le selezionate ({n})', copyQuery: 'copia la query', formatQueryText: 'formatta la query', copiedQuery: 'copiata', diagramQuery: 'query del diagramma: i suoi dati', selectHint: 'Maiusc/Ctrl+clic o Maiusc+trascina lo sfondo: selezionarne diverse (trascinane una per spostarle, Canc per rimuoverle) · Ctrl+A: tutte · Esc: nessuna', removeFromDiagram: 'togli dal diagramma', outline: 'panoramica: il diagramma intero'
	},
	de: {
		schema: 'Schema', choose: 'auswählen…', mode: 'Modus', query: 'Abfrage', script: 'Skript', data: 'Daten', options: 'Optionen', topic: 'Topic', chunk: 'Block',
		viewTree: 'Baum', viewTable: 'Tabelle', runShortcut: 'Strg+Enter', history: 'Verlauf', clearHistory: 'Verlauf löschen', runToSee: 'Führe eine Aktion aus, um ihr Ergebnis zu sehen.', useName: '{name} verwenden', didYouMean: 'Meintest du', rows: '{n} Zeilen', copy: 'kopieren', copied: 'kopiert', export: 'exportieren', tsv: 'TXT (tabulatorgetrennt)',
		showing: '{shown} von {total} Zeilen angezeigt: die Downloads enthalten alle.',
		reasonNoCredential: 'noch keine Anmeldedaten', reasonScriptsDisabled: 'Skripte sind in diesem Schema deaktiviert',
		reasonNoPermission: '„{name}“ hat die Berechtigung {permission} nicht', noticeNoSchema: 'kein Schema ist bereit',
		noticeCredential: 'die Anmeldedaten sind für dieses Schema nicht gültig', newTab: 'neuer Tab', tabNamed: 'Abfrage', close: 'schließen', tabLimit: 'höchstens {n} Tabs', tabName: 'Name des Tabs', model: 'Modell', entity: 'Entität', depth1: 'Nachbarn', depth2: '2 Ebenen', wholeModel: 'ganzes Modell', namesOnly: 'nur Namen', fit: 'einpassen', summary: 'Entitäten: {entities} · Beziehungen: {relations}', loadingModel: 'Modell wird gezeichnet…', noDomain: 'dieses Gateway liefert keine Domäne', diagramHint: 'Klick: zentrieren · Doppelklick: abfragen · Mausrad: Zoom · Ziehen: verschieben', relayout: 'neu anordnen', diagramEditHint: 'Box ziehen: verschieben · Doppelklick: öffnen · Mausrad: Zoom · Hintergrund ziehen: verschieben', relationNames: 'Beziehungsnamen', detail: 'anzeigen', detailAll: 'alle Eigenschaften', detailKeys: 'Schlüssel (PK und FK)', detailPk: 'Primärschlüssel', detailName: 'nur der Tabellenname', addRelated: 'verwandte Tabellen hinzufügen', relatedTitle: 'Mit {name} verwandte Tabellen, die nicht im Diagramm sind', addChosen: 'hinzufügen', allNone: 'alle / keine', cancelAdd: 'abbrechen', exportAs: 'exportieren', toolSelect: 'auswählen', toolMove: 'verschieben', zoomIn: 'vergrößern', zoomOut: 'verkleinern', removeSelected: 'ausgewählte entfernen ({n})', copyQuery: 'Abfrage kopieren', formatQueryText: 'Abfrage formatieren', copiedQuery: 'kopiert', diagramQuery: 'Abfrage des Diagramms: seine Daten', selectHint: 'Umschalt/Strg+Klick oder Umschalt+Hintergrund ziehen: mehrere auswählen (eine ziehen verschiebt sie, Entf entfernt sie) · Strg+A: alle · Esc: keine', removeFromDiagram: 'aus dem Diagramm entfernen', outline: 'Übersicht: das ganze Diagramm'
	},
	nl: {
		schema: 'schema', choose: 'kies…', mode: 'modus', query: 'query', script: 'script', data: 'gegevens', options: 'opties', topic: 'topic', chunk: 'blok',
		viewTree: 'boom', viewTable: 'tabel', runShortcut: 'Ctrl+Enter', history: 'geschiedenis', clearHistory: 'geschiedenis wissen', runToSee: 'Voer een actie uit om het resultaat te zien.', useName: '{name} gebruiken', didYouMean: 'Bedoelde je', rows: '{n} rijen', copy: 'kopiëren', copied: 'gekopieerd', export: 'exporteren', tsv: 'TXT (tabgescheiden)',
		showing: '{shown} van {total} rijen getoond: de downloads bevatten ze allemaal.',
		reasonNoCredential: 'nog geen inloggegevens', reasonScriptsDisabled: 'scripts zijn uitgeschakeld in dit schema',
		reasonNoPermission: '"{name}" heeft de machtiging {permission} niet', noticeNoSchema: 'geen enkel schema is klaar',
		noticeCredential: 'de inloggegevens zijn niet geldig voor dit schema', newTab: 'nieuw tabblad', tabNamed: 'Query', close: 'sluiten', tabLimit: 'hoogstens {n} tabbladen', tabName: 'naam van het tabblad', model: 'Model', entity: 'entiteit', depth1: 'buren', depth2: '2 niveaus', wholeModel: 'heel het model', namesOnly: 'alleen namen', fit: 'passend maken', summary: 'entiteiten: {entities} · relaties: {relations}', loadingModel: 'Het model wordt getekend…', noDomain: 'deze gateway geeft geen domein', diagramHint: 'klik: centreren · dubbelklik: opvragen · scrollwiel: zoom · slepen: verplaatsen', relayout: 'opnieuw schikken', diagramEditHint: 'sleep een vak: verplaatsen · dubbelklik: openen · scrollwiel: zoom · sleep de achtergrond: verplaatsen', relationNames: 'namen van relaties', detail: 'tonen', detailAll: 'alle eigenschappen', detailKeys: 'sleutels (PK en FK)', detailPk: 'primaire sleutel', detailName: 'alleen de tabelnaam', addRelated: 'gerelateerde tabellen toevoegen', relatedTitle: 'Met {name} gerelateerde tabellen die niet in het diagram staan', addChosen: 'toevoegen', allNone: 'alle / geen', cancelAdd: 'annuleren', exportAs: 'exporteren', toolSelect: 'selecteren', toolMove: 'verplaatsen', zoomIn: 'inzoomen', zoomOut: 'uitzoomen', removeSelected: 'geselecteerde verwijderen ({n})', copyQuery: 'query kopiëren', formatQueryText: 'query opmaken', copiedQuery: 'gekopieerd', diagramQuery: 'query van het diagram: de gegevens', selectHint: 'Shift/Ctrl+klik of Shift+achtergrond slepen: meerdere selecteren (sleep er een om ze te verplaatsen, Delete om ze te verwijderen) · Ctrl+A: alle · Esc: geen', removeFromDiagram: 'uit het diagram halen', outline: 'overzicht: het hele diagram'
	},
	ca: {
		schema: 'esquema', choose: 'tria…', mode: 'mode', query: 'consulta', script: 'script', data: 'dades', options: 'opcions', topic: 'tòpic', chunk: 'lot',
		viewTree: 'arbre', viewTable: 'taula', runShortcut: 'Ctrl+Retorn', history: 'historial', clearHistory: "esborra l'historial", runToSee: "Executa una acció per veure'n el resultat.", useName: 'fes servir {name}', didYouMean: 'Volies dir', rows: '{n} files', copy: 'copia', copied: 'copiat', export: 'exporta', tsv: 'TXT (separat per tabulacions)',
		showing: 'Es mostren {shown} de {total} files: les baixades les tenen totes.',
		reasonNoCredential: 'encara no hi ha credencial', reasonScriptsDisabled: 'els scripts estan desactivats en aquest esquema',
		reasonNoPermission: '"{name}" no té el permís {permission}', noticeNoSchema: 'cap esquema no està a punt',
		noticeCredential: 'la credencial no és vàlida per a aquest esquema', newTab: 'pestanya nova', tabNamed: 'Consulta', close: 'tanca', tabLimit: 'com a màxim {n} pestanyes', tabName: 'nom de la pestanya', model: 'Model', entity: 'entitat', depth1: 'veïnes', depth2: '2 nivells', wholeModel: 'tot el model', namesOnly: 'només noms', fit: 'ajusta', summary: 'entitats: {entities} · relacions: {relations}', loadingModel: 'Dibuixant el model…', noDomain: 'aquest gateway no dona el domini', diagramHint: 'clic: centra · doble clic: consulta · roda: zoom · arrossega: mou', relayout: 'reorganitza', diagramEditHint: 'arrossega una caixa: mou-la · doble clic: obre-la · roda: zoom · arrossega el fons: mou', relationNames: 'noms de les relacions', detail: 'mostra', detailAll: 'totes les propietats', detailKeys: 'claus (PK i FK)', detailPk: 'clau primària', detailName: 'només el nom de la taula', addRelated: 'afegeix les taules relacionades', relatedTitle: 'Taules relacionades amb {name} que no són al diagrama', addChosen: 'afegeix', allNone: 'totes / cap', cancelAdd: 'cancel·la', exportAs: 'exporta', toolSelect: 'selecciona', toolMove: 'mou', zoomIn: 'apropa', zoomOut: 'allunya', removeSelected: 'treu les seleccionades ({n})', copyQuery: 'copia la consulta', formatQueryText: 'formata la consulta', copiedQuery: 'copiada', diagramQuery: 'consulta del diagrama: les seves dades', selectHint: 'Maj/Ctrl+clic o Maj+arrossega el fons: selecciona’n diverses (arrossega’n una per moure-les, Supr per treure-les) · Ctrl+A: totes · Esc: cap', removeFromDiagram: 'treu del diagrama', outline: 'outline: el diagrama sencer'
	},
	gl: {
		schema: 'esquema', choose: 'escoller…', mode: 'modo', query: 'consulta', script: 'script', data: 'datos', options: 'opcións', topic: 'tópico', chunk: 'lote',
		viewTree: 'árbore', viewTable: 'táboa', runShortcut: 'Ctrl+Intro', history: 'historial', clearHistory: 'borrar o historial', runToSee: 'Executa unha acción para ver o seu resultado.', useName: 'usar {name}', didYouMean: 'Quixeches dicir', rows: '{n} filas', copy: 'copiar', copied: 'copiado', export: 'exportar', tsv: 'TXT (separado por tabulacións)',
		showing: 'Móstranse {shown} de {total} filas: as descargas teñen todas.',
		reasonNoCredential: 'aínda non hai credencial', reasonScriptsDisabled: 'os scripts están desactivados neste esquema',
		reasonNoPermission: '"{name}" non ten o permiso {permission}', noticeNoSchema: 'ningún esquema está listo',
		noticeCredential: 'a credencial non é válida para este esquema', newTab: 'nova lapela', tabNamed: 'Consulta', close: 'pechar', tabLimit: 'como máximo {n} lapelas', tabName: 'nome da lapela', model: 'Modelo', entity: 'entidade', depth1: 'veciñas', depth2: '2 niveis', wholeModel: 'todo o modelo', namesOnly: 'só nomes', fit: 'axustar', summary: 'entidades: {entities} · relacións: {relations}', loadingModel: 'Debuxando o modelo…', noDomain: 'este gateway non dá o dominio', diagramHint: 'clic: centrar · dobre clic: consultar · roda: zoom · arrastrar: mover', relayout: 'reorganizar', diagramEditHint: 'arrastrar unha caixa: movela · dobre clic: abrila · roda: zoom · arrastrar o fondo: mover', relationNames: 'nomes das relacións', detail: 'mostrar', detailAll: 'todas as propiedades', detailKeys: 'claves (PK e FK)', detailPk: 'clave primaria', detailName: 'só o nome da táboa', addRelated: 'engadir as táboas relacionadas', relatedTitle: 'Táboas relacionadas con {name} que non están no diagrama', addChosen: 'engadir', allNone: 'todas / ningunha', cancelAdd: 'cancelar', exportAs: 'exportar', toolSelect: 'seleccionar', toolMove: 'mover', zoomIn: 'achegar', zoomOut: 'afastar', removeSelected: 'quitar as seleccionadas ({n})', copyQuery: 'copiar a consulta', formatQueryText: 'formatar a consulta', copiedQuery: 'copiada', diagramQuery: 'consulta do diagrama: os seus datos', selectHint: 'Maiús/Ctrl+clic ou Maiús+arrastrar o fondo: seleccionar varias (arrastra unha para movelas, Supr para quitalas) · Ctrl+A: todas · Esc: ningunha', removeFromDiagram: 'quitar do diagrama', outline: 'outline: o diagrama enteiro'
	},
	eu: {
		schema: 'eskema', choose: 'aukeratu…', mode: 'modua', query: 'kontsulta', script: 'scripta', data: 'datuak', options: 'aukerak', topic: 'gaia', chunk: 'sorta',
		viewTree: 'zuhaitza', viewTable: 'taula', runShortcut: 'Ctrl+Sartu', history: 'historia', clearHistory: 'garbitu historia', runToSee: 'Exekutatu ekintza bat emaitza ikusteko.', useName: 'erabili {name}', didYouMean: 'Hau esan nahi zenuen', rows: '{n} errenkada', copy: 'kopiatu', copied: 'kopiatuta', export: 'esportatu', tsv: 'TXT (tabulazioz bereizia)',
		showing: '{total} errenkadatik {shown} erakusten dira: deskargek guztiak dituzte.',
		reasonNoCredential: 'oraindik ez dago kredentzialik', reasonScriptsDisabled: 'scriptak desgaituta daude eskema honetan',
		reasonNoPermission: '"{name}"(e)k ez du {permission} baimena', noticeNoSchema: 'eskema bat ere ez dago prest',
		noticeCredential: 'kredentziala ez da baliozkoa eskema honetarako', newTab: 'fitxa berria', tabNamed: 'Kontsulta', close: 'itxi', tabLimit: 'gehienez {n} fitxa', tabName: 'fitxaren izena', model: 'Eredua', entity: 'entitatea', depth1: 'auzokideak', depth2: '2 maila', wholeModel: 'eredu osoa', namesOnly: 'izenak bakarrik', fit: 'doitu', summary: 'entitateak: {entities} · erlazioak: {relations}', loadingModel: 'Eredua marrazten…', noDomain: 'gateway honek ez du domeinua ematen', diagramHint: 'klik: erdiratu · klik bikoitza: kontsultatu · gurpila: zooma · arrastatu: mugitu', relayout: 'berrantolatu', diagramEditHint: 'arrastatu kutxa bat: mugitu · klik bikoitza: ireki · gurpila: zooma · arrastatu atzealdea: mugitu', relationNames: 'erlazioen izenak', detail: 'erakutsi', detailAll: 'propietate guztiak', detailKeys: 'gakoak (PK eta FK)', detailPk: 'gako nagusia', detailName: 'taularen izena soilik', addRelated: 'gehitu erlazionatutako taulak', relatedTitle: '{name}-rekin erlazionatutako taulak, diagraman ez daudenak', addChosen: 'gehitu', allNone: 'denak / bat ere ez', cancelAdd: 'utzi', exportAs: 'esportatu', toolSelect: 'hautatu', toolMove: 'mugitu', zoomIn: 'handiagotu', zoomOut: 'txikiagotu', removeSelected: 'kendu hautatuak ({n})', copyQuery: 'kopiatu kontsulta', formatQueryText: 'formateatu kontsulta', copiedQuery: 'kopiatuta', diagramQuery: 'diagramaren kontsulta: bere datuak', selectHint: 'Maius/Ktrl+klik edo Maius+hondoa arrastatu: hainbat hautatu (arrastatu bat mugitzeko, Ezabatu kentzeko) · Ktrl+A: denak · Esc: bat ere ez', removeFromDiagram: 'kendu diagramatik', outline: 'outline: diagrama osoa'
	}
}

/** The texts of a language (English for one it doesn't know) */
export const messagesOf = (locale: string | undefined): Messages => MESSAGES[(locale as Locale)] ?? MESSAGES[(locale ?? '').slice(0, 2) as Locale] ?? en

/** A text with its {placeholders} replaced */
export const format = (text: string, values: Record<string, string | number> = {}): string =>
	text.replace(/\{(\w+)\}/g, (all, key) => values[key] !== undefined ? String(values[key]) : all)

/** A text of the domain or the controller (English) in a language: the ones it knows, else as it is */
export const localize = (text: string | undefined, m: Messages): string | undefined => {
	if (text === undefined || m === en) return text
	switch (text) {
	case en.reasonNoCredential: return m.reasonNoCredential
	case en.reasonScriptsDisabled: return m.reasonScriptsDisabled
	case en.noticeNoSchema: return m.noticeNoSchema
	case en.noticeCredential: return m.noticeCredential
	}
	const permission = /^"(.*)" has no (\w+) permission$/.exec(text)
	return permission ? format(m.reasonNoPermission, { name: permission[1], permission: permission[2] }) : text
}
