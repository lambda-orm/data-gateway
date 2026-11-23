import { Locale } from './i18n'

/** The texts of the query wizard (QueryWizard) */
export interface WizardMessages {
	wizard: string
	title: string
	startFrom: string
	tablesHint: string
	filter: string
	filterHint: string
	sort: string
	addSort: string
	ascending: string
	descending: string
	sortHint: string
	removeSort: string
	page: string
	pageNumber: string
	pageSize: string
	pageHint: string
	query: string
	cancel: string
	create: string
	update: string
	edited: string
	cantJoin: string
}

const en: WizardMessages = {
	wizard: 'wizard', title: 'Query wizard', startFrom: 'start from',
	tablesHint: 'Choose the fields of each table (none: all of them); + on a table adds its related ones, × takes it out.',
	filter: 'filter', filterHint: 'on p, the {entity} the query starts from: p.price > 10 && p.category.name == name; empty, no filter',
	sort: 'order', addSort: 'add an order', ascending: 'ascending', descending: 'descending', sortHint: 'by the columns of the result; empty, no order', removeSort: 'remove the order',
	page: 'page', pageNumber: 'page', pageSize: 'rows per page', pageHint: 'whole numbers; without rows per page, every row',
	query: 'the query', cancel: 'cancel', create: 'create the query', update: 'update the query',
	edited: 'The query was edited by hand: updating it replaces it.',
	cantJoin: '{entity} can’t join: a table of a relation to many joins the start or another one of a relation to many'
}

const MESSAGES: Record<Locale, WizardMessages> = {
	en,
	es: {
		wizard: 'asistente', title: 'Asistente de consultas', startFrom: 'partir de',
		tablesHint: 'Elegí los campos de cada tabla (ninguno: todos); el + de una tabla agrega sus relacionadas, la × la saca.',
		filter: 'filtro', filterHint: 'sobre p, la {entity} de la que parte la consulta: p.price > 10 && p.category.name == name; vacío, sin filtro',
		sort: 'orden', addSort: 'agregar un orden', ascending: 'ascendente', descending: 'descendente', sortHint: 'por las columnas del resultado; vacío, sin orden', removeSort: 'quitar el orden',
		page: 'página', pageNumber: 'página', pageSize: 'filas por página', pageHint: 'enteros; sin filas por página, todas las filas',
		query: 'la consulta', cancel: 'cancelar', create: 'crear la consulta', update: 'actualizar la consulta',
		edited: 'La consulta se editó a mano: actualizarla la reemplaza.',
		cantJoin: '{entity} no se puede unir: una tabla de una relación a muchos se une a la de partida o a otra de una relación a muchos'
	},
	pt: {
		wizard: 'assistente', title: 'Assistente de consultas', startFrom: 'partir de',
		tablesHint: 'Escolha os campos de cada tabela (nenhum: todos); o + de uma tabela adiciona as relacionadas, o × a remove.',
		filter: 'filtro', filterHint: 'sobre p, a {entity} de onde a consulta parte: p.price > 10 && p.category.name == name; vazio, sem filtro',
		sort: 'ordem', addSort: 'adicionar uma ordem', ascending: 'crescente', descending: 'decrescente', sortHint: 'pelas colunas do resultado; vazio, sem ordem', removeSort: 'remover a ordem',
		page: 'página', pageNumber: 'página', pageSize: 'linhas por página', pageHint: 'inteiros; sem linhas por página, todas as linhas',
		query: 'a consulta', cancel: 'cancelar', create: 'criar a consulta', update: 'atualizar a consulta',
		edited: 'A consulta foi editada à mão: atualizá-la a substitui.',
		cantJoin: '{entity} não pode ser unida: uma tabela de uma relação para muitos se une à de partida ou a outra de uma relação para muitos'
	},
	fr: {
		wizard: 'assistant', title: 'Assistant de requêtes', startFrom: 'partir de',
		tablesHint: 'Choisissez les champs de chaque table (aucun : tous) ; le + d’une table ajoute ses tables liées, le × la retire.',
		filter: 'filtre', filterHint: 'sur p, la {entity} d’où part la requête : p.price > 10 && p.category.name == name ; vide, sans filtre',
		sort: 'ordre', addSort: 'ajouter un ordre', ascending: 'croissant', descending: 'décroissant', sortHint: 'par les colonnes du résultat ; vide, sans ordre', removeSort: 'retirer l’ordre',
		page: 'page', pageNumber: 'page', pageSize: 'lignes par page', pageHint: 'des entiers ; sans lignes par page, toutes les lignes',
		query: 'la requête', cancel: 'annuler', create: 'créer la requête', update: 'mettre à jour la requête',
		edited: 'La requête a été modifiée à la main : la mettre à jour la remplace.',
		cantJoin: '{entity} ne peut pas être jointe : une table d’une relation vers plusieurs se joint à celle de départ ou à une autre de ce type'
	},
	it: {
		wizard: 'procedura guidata', title: 'Procedura guidata delle query', startFrom: 'partire da',
		tablesHint: 'Scegli i campi di ogni tabella (nessuno: tutti); il + di una tabella aggiunge le correlate, la × la toglie.',
		filter: 'filtro', filterHint: 'su p, la {entity} da cui parte la query: p.price > 10 && p.category.name == name; vuoto, nessun filtro',
		sort: 'ordine', addSort: 'aggiungi un ordine', ascending: 'crescente', descending: 'decrescente', sortHint: 'per le colonne del risultato; vuoto, nessun ordine', removeSort: 'togli l’ordine',
		page: 'pagina', pageNumber: 'pagina', pageSize: 'righe per pagina', pageHint: 'interi; senza righe per pagina, tutte le righe',
		query: 'la query', cancel: 'annulla', create: 'crea la query', update: 'aggiorna la query',
		edited: 'La query è stata modificata a mano: aggiornarla la sostituisce.',
		cantJoin: '{entity} non si può unire: una tabella di una relazione a molti si unisce a quella di partenza o a un’altra di una relazione a molti'
	},
	de: {
		wizard: 'Assistent', title: 'Abfrage-Assistent', startFrom: 'ausgehend von',
		tablesHint: 'Wähle die Felder jeder Tabelle (keine: alle); das + einer Tabelle fügt ihre verwandten hinzu, das × entfernt sie.',
		filter: 'Filter', filterHint: 'auf p, die {entity}, von der die Abfrage ausgeht: p.price > 10 && p.category.name == name; leer, kein Filter',
		sort: 'Reihenfolge', addSort: 'Reihenfolge hinzufügen', ascending: 'aufsteigend', descending: 'absteigend', sortHint: 'nach den Spalten des Ergebnisses; leer, keine Reihenfolge', removeSort: 'Reihenfolge entfernen',
		page: 'Seite', pageNumber: 'Seite', pageSize: 'Zeilen pro Seite', pageHint: 'ganze Zahlen; ohne Zeilen pro Seite alle Zeilen',
		query: 'die Abfrage', cancel: 'abbrechen', create: 'Abfrage erstellen', update: 'Abfrage aktualisieren',
		edited: 'Die Abfrage wurde von Hand bearbeitet: Aktualisieren ersetzt sie.',
		cantJoin: '{entity} kann nicht verbunden werden: eine Tabelle einer Beziehung zu vielen verbindet sich mit der Ausgangstabelle oder einer anderen dieser Art'
	},
	nl: {
		wizard: 'wizard', title: 'Querywizard', startFrom: 'vertrekken van',
		tablesHint: 'Kies de velden van elke tabel (geen: allemaal); de + van een tabel voegt de gerelateerde toe, de × haalt hem weg.',
		filter: 'filter', filterHint: 'op p, de {entity} waar de query van vertrekt: p.price > 10 && p.category.name == name; leeg, geen filter',
		sort: 'volgorde', addSort: 'een volgorde toevoegen', ascending: 'oplopend', descending: 'aflopend', sortHint: 'op de kolommen van het resultaat; leeg, geen volgorde', removeSort: 'de volgorde verwijderen',
		page: 'pagina', pageNumber: 'pagina', pageSize: 'rijen per pagina', pageHint: 'gehele getallen; zonder rijen per pagina, alle rijen',
		query: 'de query', cancel: 'annuleren', create: 'de query maken', update: 'de query bijwerken',
		edited: 'De query is met de hand bewerkt: bijwerken vervangt hem.',
		cantJoin: '{entity} kan niet worden gekoppeld: een tabel van een relatie naar vele koppelt aan de vertrektabel of een andere van die soort'
	},
	ca: {
		wizard: 'assistent', title: 'Assistent de consultes', startFrom: 'partir de',
		tablesHint: 'Tria els camps de cada taula (cap: tots); el + d’una taula afegeix les relacionades, la × la treu.',
		filter: 'filtre', filterHint: 'sobre p, la {entity} de la qual parteix la consulta: p.price > 10 && p.category.name == name; buit, sense filtre',
		sort: 'ordre', addSort: 'afegir un ordre', ascending: 'ascendent', descending: 'descendent', sortHint: 'per les columnes del resultat; buit, sense ordre', removeSort: 'treure l’ordre',
		page: 'pàgina', pageNumber: 'pàgina', pageSize: 'files per pàgina', pageHint: 'enters; sense files per pàgina, totes les files',
		query: 'la consulta', cancel: 'cancel·lar', create: 'crear la consulta', update: 'actualitzar la consulta',
		edited: 'La consulta s’ha editat a mà: actualitzar-la la substitueix.',
		cantJoin: '{entity} no es pot unir: una taula d’una relació a molts s’uneix a la de partida o a una altra d’una relació a molts'
	},
	gl: {
		wizard: 'asistente', title: 'Asistente de consultas', startFrom: 'partir de',
		tablesHint: 'Escolle os campos de cada táboa (ningún: todos); o + dunha táboa engade as relacionadas, a × quítaa.',
		filter: 'filtro', filterHint: 'sobre p, a {entity} da que parte a consulta: p.price > 10 && p.category.name == name; baleiro, sen filtro',
		sort: 'orde', addSort: 'engadir unha orde', ascending: 'ascendente', descending: 'descendente', sortHint: 'polas columnas do resultado; baleiro, sen orde', removeSort: 'quitar a orde',
		page: 'páxina', pageNumber: 'páxina', pageSize: 'filas por páxina', pageHint: 'enteiros; sen filas por páxina, todas as filas',
		query: 'a consulta', cancel: 'cancelar', create: 'crear a consulta', update: 'actualizar a consulta',
		edited: 'A consulta editouse a man: actualizala substitúea.',
		cantJoin: '{entity} non se pode unir: unha táboa dunha relación a moitos únese á de partida ou a outra dunha relación a moitos'
	},
	eu: {
		wizard: 'morroia', title: 'Kontsulten morroia', startFrom: 'abiapuntua',
		tablesHint: 'Aukeratu taula bakoitzaren eremuak (bat ere ez: denak); taula baten +-ak erlazionatuak gehitzen ditu, ×-ak kentzen du.',
		filter: 'iragazkia', filterHint: 'p-ren gainean, kontsultaren abiapuntuko {entity}: p.price > 10 && p.category.name == name; hutsik, iragazkirik gabe',
		sort: 'ordena', addSort: 'gehitu ordena bat', ascending: 'gorakorra', descending: 'beherakorra', sortHint: 'emaitzaren zutabeen arabera; hutsik, ordenarik gabe', removeSort: 'kendu ordena',
		page: 'orria', pageNumber: 'orria', pageSize: 'errenkadak orriko', pageHint: 'zenbaki osoak; orriko errenkadarik gabe, errenkada guztiak',
		query: 'kontsulta', cancel: 'utzi', create: 'sortu kontsulta', update: 'eguneratu kontsulta',
		edited: 'Kontsulta eskuz editatu da: eguneratzeak ordezkatzen du.',
		cantJoin: '{entity} ezin da elkartu: askorako erlazio baten taula abiapuntukoari edo askorako erlazio bateko beste bati elkartzen zaio'
	}
}

export const wizardMessagesOf = (locale: string | undefined): WizardMessages =>
	MESSAGES[(locale as Locale)] ?? MESSAGES[(locale ?? '').slice(0, 2) as Locale] ?? en
