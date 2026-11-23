import type { Locale } from '@lambdaorm/ui'

/** The permissions of the gateway (docs/DATA_GATEWAY.md §6.2): those of the data and those of the administration */
export const DATA_PERMISSIONS = ['read', 'write', 'script', 'queue', 'stageImport']
export const ADMIN_PERMISSIONS = ['schemaRead', 'schemaWrite', 'schemaAdmin', 'workbenchWrite', 'ddl', 'build', 'sessionAdmin']

type Descriptions = Record<string, string> & { data: string, admin: string, granted: string, notGranted: string, other: string }

const EN: Descriptions = {
	data: 'Data', admin: 'Administration', granted: 'granted', notGranted: 'not granted', other: 'Other',
	read: 'Read: queries that only select, the schema, plans, metadata and exports of a stage.',
	write: 'Write: queries that insert, update, delete, upsert or merge rows.',
	script: 'Run scripts (3xpr): a script can do anything inside the schema.',
	queue: 'Send queries to the queue to run later (and write, when they write).',
	stageImport: 'Import data into a stage.',
	schemaRead: 'Read the lambdaORM.yaml of each workspace (without secrets) and validate it.',
	schemaWrite: 'Change the lambdaORM.yaml: entities, sources, stages… from the forms or the YAML.',
	schemaAdmin: 'Create and remove workspaces (schemas).',
	workbenchWrite: 'Save queries, scripts and diagrams in the projects of the workspaces.',
	ddl: 'Change the structure of the databases of a stage (push, drop).',
	build: 'Generate the code of the domain (model and repositories) in src/ of the workspace.',
	sessionAdmin: 'See every session of management (who is connected) and revoke those of other credentials.'
}
const ES: Descriptions = {
	data: 'Datos', admin: 'Administración', granted: 'otorgado', notGranted: 'no otorgado', other: 'Otros',
	read: 'Leer: consultas que solo seleccionan, el esquema, planes, metadatos y exportar un stage.',
	write: 'Escribir: consultas que insertan, actualizan, borran, hacen upsert o merge de filas.',
	script: 'Ejecutar scripts (3xpr): un script puede hacer cualquier cosa dentro del esquema.',
	queue: 'Enviar consultas a la cola para ejecutarlas después (y escribir, si escriben).',
	stageImport: 'Importar datos en un stage.',
	schemaRead: 'Leer el lambdaORM.yaml de cada workspace (sin secretos) y validarlo.',
	schemaWrite: 'Cambiar el lambdaORM.yaml: entidades, sources, stages… desde los formularios o el YAML.',
	schemaAdmin: 'Crear y eliminar workspaces (esquemas).',
	workbenchWrite: 'Guardar consultas, scripts y diagramas en los proyectos de los workspaces.',
	ddl: 'Cambiar la estructura de las bases de un stage (push, drop).',
	build: 'Generar el código del dominio (modelo y repositorios) en src/ del workspace.',
	sessionAdmin: 'Ver todas las sesiones de management (quién está conectado) y revocar las de otras credenciales.'
}
const PT: Descriptions = {
	data: 'Dados', admin: 'Administração', granted: 'concedida', notGranted: 'não concedida', other: 'Outras',
	read: 'Ler: consultas que só selecionam, o esquema, planos, metadados e exportações de um stage.',
	write: 'Escrever: consultas que inserem, atualizam, apagam, fazem upsert ou merge de linhas.',
	script: 'Executar scripts (3xpr): um script pode fazer qualquer coisa dentro do esquema.',
	queue: 'Enviar consultas à fila para executar depois (e escrever, se escrevem).',
	stageImport: 'Importar dados em um stage.',
	schemaRead: 'Ler o lambdaORM.yaml de cada workspace (sem segredos) e validá-lo.',
	schemaWrite: 'Alterar o lambdaORM.yaml: entidades, sources, stages… pelos formulários ou pelo YAML.',
	schemaAdmin: 'Criar e remover workspaces (esquemas).',
	workbenchWrite: 'Salvar consultas, scripts e diagramas nos projetos dos workspaces.',
	ddl: 'Alterar a estrutura dos bancos de um stage (push, drop).',
	build: 'Gerar o código do domínio (modelo e repositórios) em src/ do workspace.',
	sessionAdmin: 'Ver todas as sessões do management (quem está conectado) e revogar as de outras credenciais.'
}
const FR: Descriptions = {
	data: 'Données', admin: 'Administration', granted: 'accordée', notGranted: 'non accordée', other: 'Autres',
	read: 'Lire : requêtes qui ne font que sélectionner, le schéma, les plans, les métadonnées et les exports d’un stage.',
	write: 'Écrire : requêtes qui insèrent, modifient, suppriment, font un upsert ou un merge de lignes.',
	script: 'Exécuter des scripts (3xpr) : un script peut tout faire dans le schéma.',
	queue: 'Envoyer des requêtes à la file pour les exécuter plus tard (et écrire, si elles écrivent).',
	stageImport: 'Importer des données dans un stage.',
	schemaRead: 'Lire le lambdaORM.yaml de chaque workspace (sans secrets) et le valider.',
	schemaWrite: 'Modifier le lambdaORM.yaml : entités, sources, stages… depuis les formulaires ou le YAML.',
	schemaAdmin: 'Créer et supprimer des workspaces (schémas).',
	workbenchWrite: 'Enregistrer requêtes, scripts et diagrammes dans les projets des workspaces.',
	ddl: 'Modifier la structure des bases d’un stage (push, drop).',
	build: 'Générer le code du domaine (modèle et dépôts) dans src/ du workspace.',
	sessionAdmin: 'Voir toutes les sessions de management (qui est connecté) et révoquer celles des autres identifiants.'
}
const IT: Descriptions = {
	data: 'Dati', admin: 'Amministrazione', granted: 'concesso', notGranted: 'non concesso', other: 'Altri',
	read: 'Leggere: query che selezionano soltanto, lo schema, i piani, i metadati e gli export di uno stage.',
	write: 'Scrivere: query che inseriscono, aggiornano, eliminano, fanno upsert o merge di righe.',
	script: 'Eseguire script (3xpr): uno script può fare qualsiasi cosa nello schema.',
	queue: 'Inviare query alla coda per eseguirle dopo (e scrivere, se scrivono).',
	stageImport: 'Importare dati in uno stage.',
	schemaRead: 'Leggere il lambdaORM.yaml di ogni workspace (senza segreti) e validarlo.',
	schemaWrite: 'Modificare il lambdaORM.yaml: entità, sources, stages… dai moduli o dallo YAML.',
	schemaAdmin: 'Creare ed eliminare workspace (schemi).',
	workbenchWrite: 'Salvare query, script e diagrammi nei progetti dei workspace.',
	ddl: 'Modificare la struttura dei database di uno stage (push, drop).',
	build: 'Generare il codice del dominio (modello e repository) in src/ del workspace.',
	sessionAdmin: 'Vedere tutte le sessioni di management (chi è connesso) e revocare quelle di altre credenziali.'
}
const DE: Descriptions = {
	data: 'Daten', admin: 'Verwaltung', granted: 'erteilt', notGranted: 'nicht erteilt', other: 'Weitere',
	read: 'Lesen: Abfragen, die nur auswählen, das Schema, Pläne, Metadaten und Exporte eines Stage.',
	write: 'Schreiben: Abfragen, die Zeilen einfügen, ändern, löschen, upserten oder mergen.',
	script: 'Skripte ausführen (3xpr): ein Skript kann im Schema alles tun.',
	queue: 'Abfragen in die Warteschlange stellen, um sie später auszuführen (und schreiben, wenn sie schreiben).',
	stageImport: 'Daten in einen Stage importieren.',
	schemaRead: 'Die lambdaORM.yaml jedes Workspace lesen (ohne Geheimnisse) und prüfen.',
	schemaWrite: 'Die lambdaORM.yaml ändern: Entitäten, Sources, Stages… über die Formulare oder das YAML.',
	schemaAdmin: 'Workspaces (Schemas) anlegen und entfernen.',
	workbenchWrite: 'Abfragen, Skripte und Diagramme in den Projekten der Workspaces speichern.',
	ddl: 'Die Struktur der Datenbanken eines Stage ändern (push, drop).',
	build: 'Den Code der Domäne (Modell und Repositories) in src/ des Workspace erzeugen.',
	sessionAdmin: 'Alle Sitzungen von management sehen (wer verbunden ist) und die anderer Anmeldedaten widerrufen.'
}
const NL: Descriptions = {
	data: 'Gegevens', admin: 'Beheer', granted: 'toegekend', notGranted: 'niet toegekend', other: 'Overige',
	read: 'Lezen: queries die alleen selecteren, het schema, plannen, metadata en exports van een stage.',
	write: 'Schrijven: queries die rijen invoegen, wijzigen, verwijderen, upserten of mergen.',
	script: 'Scripts uitvoeren (3xpr): een script kan alles binnen het schema.',
	queue: 'Queries naar de wachtrij sturen om later uit te voeren (en schrijven, als ze schrijven).',
	stageImport: 'Gegevens in een stage importeren.',
	schemaRead: 'De lambdaORM.yaml van elke workspace lezen (zonder geheimen) en valideren.',
	schemaWrite: 'De lambdaORM.yaml wijzigen: entiteiten, sources, stages… via de formulieren of de YAML.',
	schemaAdmin: 'Workspaces (schema’s) aanmaken en verwijderen.',
	workbenchWrite: 'Queries, scripts en diagrammen opslaan in de projecten van de workspaces.',
	ddl: 'De structuur van de databases van een stage wijzigen (push, drop).',
	build: 'De code van het domein (model en repositories) genereren in src/ van de workspace.',
	sessionAdmin: 'Alle sessies van management zien (wie verbonden is) en die van andere inloggegevens intrekken.'
}
const CA: Descriptions = {
	data: 'Dades', admin: 'Administració', granted: 'atorgat', notGranted: 'no atorgat', other: 'Altres',
	read: 'Llegir: consultes que només seleccionen, l’esquema, plans, metadades i exportacions d’un stage.',
	write: 'Escriure: consultes que insereixen, actualitzen, esborren, fan upsert o merge de files.',
	script: 'Executar scripts (3xpr): un script pot fer qualsevol cosa dins l’esquema.',
	queue: 'Enviar consultes a la cua per executar-les després (i escriure, si escriuen).',
	stageImport: 'Importar dades en un stage.',
	schemaRead: 'Llegir el lambdaORM.yaml de cada workspace (sense secrets) i validar-lo.',
	schemaWrite: 'Canviar el lambdaORM.yaml: entitats, sources, stages… des dels formularis o el YAML.',
	schemaAdmin: 'Crear i eliminar workspaces (esquemes).',
	workbenchWrite: 'Desar consultes, scripts i diagrames als projectes dels workspaces.',
	ddl: 'Canviar l’estructura de les bases d’un stage (push, drop).',
	build: 'Generar el codi del domini (model i repositoris) a src/ del workspace.',
	sessionAdmin: 'Veure totes les sessions de management (qui està connectat) i revocar les d’altres credencials.'
}
const GL: Descriptions = {
	data: 'Datos', admin: 'Administración', granted: 'outorgado', notGranted: 'non outorgado', other: 'Outros',
	read: 'Ler: consultas que só seleccionan, o esquema, plans, metadatos e exportacións dun stage.',
	write: 'Escribir: consultas que inseren, actualizan, borran, fan upsert ou merge de filas.',
	script: 'Executar scripts (3xpr): un script pode facer calquera cousa dentro do esquema.',
	queue: 'Enviar consultas á cola para executalas despois (e escribir, se escriben).',
	stageImport: 'Importar datos nun stage.',
	schemaRead: 'Ler o lambdaORM.yaml de cada workspace (sen segredos) e validalo.',
	schemaWrite: 'Cambiar o lambdaORM.yaml: entidades, sources, stages… desde os formularios ou o YAML.',
	schemaAdmin: 'Crear e eliminar workspaces (esquemas).',
	workbenchWrite: 'Gardar consultas, scripts e diagramas nos proxectos dos workspaces.',
	ddl: 'Cambiar a estrutura das bases dun stage (push, drop).',
	build: 'Xerar o código do dominio (modelo e repositorios) en src/ do workspace.',
	sessionAdmin: 'Ver todas as sesións de management (quen está conectado) e revogar as doutras credenciais.'
}
const EU: Descriptions = {
	data: 'Datuak', admin: 'Administrazioa', granted: 'emanda', notGranted: 'eman gabe', other: 'Besteak',
	read: 'Irakurri: hautatu besterik egiten ez duten kontsultak, eskema, planak, metadatuak eta stage baten esportazioak.',
	write: 'Idatzi: errenkadak txertatu, eguneratu, ezabatu, upsert edo merge egiten dituzten kontsultak.',
	script: 'Scriptak exekutatu (3xpr): script batek edozer egin dezake eskemaren barruan.',
	queue: 'Kontsultak ilarara bidali geroago exekutatzeko (eta idatzi, idazten badute).',
	stageImport: 'Datuak stage batean inportatu.',
	schemaRead: 'Workspace bakoitzaren lambdaORM.yaml irakurri (sekreturik gabe) eta balioztatu.',
	schemaWrite: 'lambdaORM.yaml aldatu: entitateak, sources, stages… formularioetatik edo YAMLetik.',
	schemaAdmin: 'Workspaceak (eskemak) sortu eta ezabatu.',
	workbenchWrite: 'Kontsultak, scriptak eta diagramak workspaceen proiektuetan gorde.',
	ddl: 'Stage baten datu-baseen egitura aldatu (push, drop).',
	build: 'Domeinuaren kodea (eredua eta biltegiak) workspaceko src/ karpetan sortu.',
	sessionAdmin: 'Management-eko saio guztiak ikusi (nor dagoen konektatuta) eta beste kredentzialenak baliogabetu.'
}

const BY_LOCALE: Record<string, Descriptions> = { en: EN, es: ES, pt: PT, fr: FR, it: IT, de: DE, nl: NL, ca: CA, gl: GL, eu: EU }

export const permissionTextsOf = (locale: Locale): Descriptions => BY_LOCALE[locale] ?? EN
