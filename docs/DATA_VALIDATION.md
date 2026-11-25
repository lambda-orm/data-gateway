# Validación de datos — schema de Ilusor

Las `constraints` que el dominio de Ilusor (`ilusor/dev/cloud/data-gateway/workspace/ilusor/lambdaORM.yaml`) debería
tener: **172 reglas en 78 entidades**. Cada bloque tiene el formato de λORM y se copia tal cual a
`domain.entities[].constraints` de su entidad. Complementa [DATA_PROTECTION.md](./DATA_PROTECTION.md) (qué se cifra).

**Aplicadas** el 2026-11-24 al `lambdaORM.yaml` de Ilusor (copia previa en
`~/ilusor-backups/pre-encryption-20261124T101127/lambdaORM.before-constraints.yaml`). Probado en el Data Gateway: lo
válido se escribe; lo inválido es un `400 ValidationError` con el `message` de la regla, sin cambiar el dato (el error
muestra el valor ya cifrado, nunca la clave).

## De dónde sale cada regla

Cada regla lleva un comentario con su origen:

| Origen | Qué es |
| --- | --- |
| `CHECK` | Una restricción CHECK de Postgres (hay 68). λORM la valida antes, con un mensaje claro, y sigue valiendo cuando los repositorios trabajen a través del Data Gateway. |
| `Go` | Una regla que hoy solo aplica el código de los servicios Go (`services/<servicio>/…:<línea>`). |
| `nueva` | Una regla que no está en ningún lado y conviene tener. |

## Cómo las evalúa λORM

Según `queryInsertExecutor`, `queryUpdateExecutor` y `queryEvalConstraints` de `@lambdaorm/lib`:

1. **El orden.** En un insert: `default` → `writeValue` → `constraints`. En un update: `writeValue` → `constraints`.
   Una condición falsa es un `ValidationError` y la sentencia no se ejecuta.
2. **Después de `writeValue`.** Una propiedad cifrada (ver DATA_PROTECTION.md) llega cifrada: se valida
   `decrypt(x,$DATA_SECRET_KEY)`, nunca `x`.
3. **Con los datos de la sentencia.** En un update parcial las demás propiedades no están (`undefined`): **toda
   condición empieza con `isNull(x) || …`**.
4. **`||` corta.** Con `isNull(x)` verdadero no evalúa el resto, así que `decrypt(null)` (que lanza un error) no llega a
   ejecutarse. `test(null, …)` devuelve `true`.
5. **`""` como vacío.** Los servicios Go guardan `""` en lugar de `null` (emails, teléfonos, colores, `valueType`): se
   acepta como vacío. En una propiedad cifrada, el `""` cifrado: `decrypt(x,$DATA_SECRET_KEY) == ""`.
6. **Fechas.** Llegan como `Date` o como texto ISO: `a <= b` compara bien en los dos casos.
7. **La clave.** `$DATA_SECRET_KEY`: variable de ambiente de 3xpr, sin comillas. Nunca `"$$…"` ni `"${…}"`.

## Lo que no se valida aquí

Una constraint ve solo la fila. Lo que necesita otra entidad sigue en el código que escribe los datos (hoy Go; mañana
el que use el Data Gateway):

- el código postal según `Countries.postalCodePattern` del país (`customers/…/usecases/portal.go:214`);
- el CUIT/NIF según `Countries.taxIdPattern` (`portal.go:377`);
- que la agregación cuadre con el `valueType` de la propiedad (`catalog/…/rules/properties.go:29`).

Una inconsistencia: Go acepta la agregación `priority` y el CHECK de Postgres no. Se deja la lista del CHECK, que es lo
que la base acepta.

## Verificación contra los datos

El 2026-11-24 se comprobó cada regla con un script: la entidad existe, la condición es válida en 3xpr y solo usa
propiedades de su entidad; después se evaluó sobre cada fila de la base como la ve λORM (los campos cifrados,
cifrados). Lo que no cumplía se corrigió el mismo día, a través del Data Gateway (cada valor cifrado y validado):

| Entidad | Regla | Corrección |
| --- | --- | --- |
| `Customers` | `phone` en formato E.164 | 3 clientes de España: `602566422` → `+34602566422` (dos), `+34 602 49 43 76` → `+34602494376` |
| `Companies` | `phone` en formato E.164 | 1 empresa de España: `602566422` → `+34602566422` |
| `Installations` | `finishedAt` no anterior a `startedAt` | INS-2026-000001 y 000002, importadas (evento `imported`): `requestedAt` y `startedAt` tenían la fecha de la importación (15/11); pasan a la fecha real del evento, 2026-11-13T14:18:25.611Z, la de `finishedAt` y `closedAt` |

Después de corregirlos, las 172 reglas se cumplen en todas las filas.

Las listas se completaron con valores que están en los datos y Go no declara: `valueType` `trigger` (230 filas) y
`DeviceModels.source` `custom` (4 modelos).

## common

### Countries

```yaml
constraints:
# Go: catalog/internal/culture/application/usecases/country.go:26
- message: alpha2 is two capital letters (ISO 3166-1 alpha-2)
  condition: 'isNull(alpha2) || test(alpha2,"^[A-Z]{2}$")'
# nueva: el código del país es ISO 3166-1 alpha-3 (ESP, ARG)
- message: code is three capital letters (ISO 3166-1 alpha-3)
  condition: 'isNull(code) || test(code,"^[A-Z]{3}$")'
# Go: country.go:27
- message: currencyCode is three capital letters (ISO 4217)
  condition: 'isNull(currencyCode) || test(currencyCode,"^[A-Z]{3}$")'
# nueva
- message: phonePrefix is + and 1 to 4 digits
  condition: 'isNull(phonePrefix) || test(phonePrefix,"^\+[1-9][0-9]{0,3}$")'
```

### Currencies

```yaml
constraints:
# CHECK cmn_currencies
- message: minorUnits is between 0 and 4
  condition: 'isNull(minorUnits) || (minorUnits >= 0 && minorUnits <= 4)'
# Go: country.go:27
- message: code is three capital letters (ISO 4217)
  condition: 'isNull(code) || test(code,"^[A-Z]{3}$")'
```

## iot_catalog

### AreaTypeCapabilities

```yaml
constraints:
# CHECK cat_area_type_capabilities
- message: distribution is all, first, failover or oneByOne
  condition: 'isNull(distribution) || distribution.in(["all","first","failover","oneByOne"])'
```

### AreaTypeCapabilityProperties

```yaml
constraints:
# CHECK cat_area_type_capability_properties; Go acepta además priority (catalog/…/entities/area.go:18) y el CHECK
# no: se deja la lista del CHECK, que es lo que la base acepta
- message: aggregation is media, last, and, or, sum, min, max or median
  condition: 'isNull(aggregation) || aggregation.in(["media","last","and","or","sum","min","max","median"])'
# Go: catalog/internal/domain/entities/property.go:8, más trigger (en los datos: 89 controles, 141 propiedades)
- message: valueType is boolean, number, string, enum or trigger
  condition: 'isNull(valueType) || valueType == "" || valueType.in(["boolean","number","string","enum","trigger"])'
# Go: catalog/internal/domain/entities/duration.go:5
- message: readingFrequencyUnit is seconds, minutes or hours
  condition: 'isNull(readingFrequencyUnit) || readingFrequencyUnit.in(["seconds","minutes","hours"])'
# nueva
- message: readingFrequencyValue is greater than 0
  condition: 'isNull(readingFrequencyValue) || readingFrequencyValue > 0'
```

### AreaTypeCapabilityPropertyThresholdBands

```yaml
constraints:
# Go: catalog/internal/application/rules/thresholds.go:15
- message: 'color is #rgb, #rrggbb or #rrggbbaa'
  condition: 'isNull(color) || color == "" || test(color,"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")'
```

### CapabilityActions

```yaml
constraints:
# CHECK cat_capability_actions (Go acepta también "": catalog/…/entities/capability_action.go:76)
- message: distribution is all, first, failover or oneByOne
  condition: 'isNull(distribution) || distribution == "" || distribution.in(["all","first","failover","oneByOne"])'
# CHECK cat_capability_actions
- message: resultType is none, file or value
  condition: 'isNull(resultType) || resultType.in(["none","file","value"])'
```

### CapabilityControls

```yaml
constraints:
# CHECK cat_capability_controls
- message: access is read, write or readWrite
  condition: 'isNull(access) || access.in(["read","write","readWrite"])'
# CHECK cat_capability_controls
- message: placement is grid or picture
  condition: 'isNull(placement) || placement.in(["grid","picture"])'
# CHECK cat_capability_controls
- message: slot is pad, right, bottom or topRight
  condition: 'isNull(slot) || slot.in(["pad","right","bottom","topRight"])'
# Go: property.go:8, más trigger (en los datos)
- message: valueType is boolean, number, string, enum or trigger
  condition: 'isNull(valueType) || valueType == "" || valueType.in(["boolean","number","string","enum","trigger"])'
```

### CapabilityProperties

```yaml
constraints:
# CHECK cat_capability_properties
- message: access is read, write or readWrite
  condition: 'isNull(access) || access.in(["read","write","readWrite"])'
# Go: property.go:8, más trigger (en los datos)
- message: valueType is boolean, number, string, enum or trigger
  condition: 'isNull(valueType) || valueType == "" || valueType.in(["boolean","number","string","enum","trigger"])'
```

### CapabilityPropertyRateThresholds

```yaml
constraints:
# Go: duration.go:5, rules/thresholds.go:162
- message: periodUnit is seconds, minutes or hours
  condition: 'isNull(periodUnit) || periodUnit.in(["seconds","minutes","hours"])'
# nueva
- message: periodValue is greater than 0
  condition: 'isNull(periodValue) || periodValue > 0'
```

### CapabilityPropertyThresholdBands

```yaml
constraints:
# Go: rules/thresholds.go:15
- message: 'color is #rgb, #rrggbb or #rrggbbaa'
  condition: 'isNull(color) || color == "" || test(color,"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")'
```

### CaseProperties

```yaml
constraints:
# CHECK cat_case_properties
- message: aggregation is media, last, and, or, sum, min, max or median
  condition: 'isNull(aggregation) || aggregation.in(["media","last","and","or","sum","min","max","median"])'
```

### Cases

```yaml
constraints:
# CHECK cat_cases
- message: handlerStrategy is lowest, highest, all or sequential
  condition: 'isNull(handlerStrategy) || handlerStrategy.in(["lowest","highest","all","sequential"])'
```

### DeviceModelCapabilityPropertyRateThresholds

```yaml
constraints:
# Go: duration.go:5
- message: periodUnit is seconds, minutes or hours
  condition: 'isNull(periodUnit) || periodUnit.in(["seconds","minutes","hours"])'
# nueva
- message: periodValue is greater than 0
  condition: 'isNull(periodValue) || periodValue > 0'
```

### DeviceModelCapabilityPropertyThresholdBands

```yaml
constraints:
# Go: rules/thresholds.go:15
- message: 'color is #rgb, #rrggbb or #rrggbbaa'
  condition: 'isNull(color) || color == "" || test(color,"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")'
```

### DeviceModelLinkRequirementOutputStates

```yaml
constraints:
# CHECK cat_device_model_link_requirement_output_states
- message: state is previous, on or off
  condition: 'isNull(state) || state.in(["previous","on","off"])'
```

### DeviceModelLinkRequirements

```yaml
constraints:
# CHECK cat_device_model_link_requirements
- message: kind is proxy or dependent
  condition: 'isNull(kind) || kind.in(["proxy","dependent"])'
# CHECK cat_device_model_link_requirements
- message: powerOnState is previous, on or off
  condition: 'isNull(powerOnState) || powerOnState.in(["previous","on","off"])'
```

### DeviceModelPrices

```yaml
constraints:
# Go: catalog/internal/domain/entities/device_model.go:327
- message: countryCode is three capital letters (ISO 3166-1 alpha-3)
  condition: 'isNull(countryCode) || test(countryCode,"^[A-Z]{3}$")'
# Go: device_model.go:328
- message: currencyCode is three capital letters (ISO 4217)
  condition: 'isNull(currencyCode) || test(currencyCode,"^[A-Z]{3}$")'
# nueva
- message: amount is not negative
  condition: 'isNull(amount) || amount >= 0'
```

### DeviceModels

```yaml
constraints:
# CHECK cat_device_models
- message: status is draft or complete
  condition: 'isNull(status) || status.in(["draft","complete"])'
# Go: device_model.go:234 (comentario: catalog, learned o vacío), más custom (en los datos: 4 modelos)
- message: source is catalog, learned or custom
  condition: 'isNull(source) || source == "" || source.in(["catalog","learned","custom"])'
# nueva
- message: productUrl is an http(s) URL
  condition: 'isNull(productUrl) || productUrl == "" || test(productUrl,"^https?://[^\s/$.?#][^\s]*$")'
```

### DeviceRecognitionContextModalities

```yaml
constraints:
# Go: location/internal/domain/entities/device_recognition.go:19
- message: modality is image or audio
  condition: 'isNull(modality) || modality.in(["image","audio"])'
```

### LocationTemplatePropertyRateThresholds

```yaml
constraints:
# Go: duration.go:5
- message: periodUnit is seconds, minutes or hours
  condition: 'isNull(periodUnit) || periodUnit.in(["seconds","minutes","hours"])'
# nueva
- message: periodValue is greater than 0
  condition: 'isNull(periodValue) || periodValue > 0'
```

### LocationTemplatePropertyThresholdBands

```yaml
constraints:
# Go: rules/thresholds.go:15
- message: 'color is #rgb, #rrggbb or #rrggbbaa'
  condition: 'isNull(color) || color == "" || test(color,"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")'
```

### NotificationLevels

```yaml
constraints:
# Go: rules/thresholds.go:15
- message: 'color is #rgb, #rrggbb or #rrggbbaa'
  condition: 'isNull(color) || color == "" || test(color,"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")'
```

### PropertyRateThresholds

```yaml
constraints:
# Go: duration.go:5
- message: periodUnit is seconds, minutes or hours
  condition: 'isNull(periodUnit) || periodUnit.in(["seconds","minutes","hours"])'
# nueva
- message: periodValue is greater than 0
  condition: 'isNull(periodValue) || periodValue > 0'
```

### PropertyThresholdBands

```yaml
constraints:
# Go: rules/thresholds.go:15
- message: 'color is #rgb, #rrggbb or #rrggbbaa'
  condition: 'isNull(color) || color == "" || test(color,"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")'
```

### SubjectRecognitionContextModalities

```yaml
constraints:
# Go: location/internal/domain/entities/biometric_sample.go:8
- message: modality is face, voice or appearance
  condition: 'isNull(modality) || modality.in(["face","voice","appearance"])'
```

### ThresholdStates

```yaml
constraints:
# Go: rules/thresholds.go:15
- message: 'color is #rgb, #rrggbb or #rrggbbaa'
  condition: 'isNull(color) || color == "" || test(color,"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")'
```

### ZoneTypePropertyRateThresholds

```yaml
constraints:
# Go: duration.go:5
- message: periodUnit is seconds, minutes or hours
  condition: 'isNull(periodUnit) || periodUnit.in(["seconds","minutes","hours"])'
# nueva
- message: periodValue is greater than 0
  condition: 'isNull(periodValue) || periodValue > 0'
```

### ZoneTypePropertyThresholdBands

```yaml
constraints:
# Go: rules/thresholds.go:15
- message: 'color is #rgb, #rrggbb or #rrggbbaa'
  condition: 'isNull(color) || color == "" || test(color,"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")'
```

## crm

### Companies

```yaml
constraints:
# CHECK crm_companies
- message: verificationStatus is notRequested, pendingVerification, verified or rejected
  condition: 'isNull(verificationStatus) || verificationStatus.in(["notRequested","pendingVerification","verified","rejected"])'
# Go: contact.go:79 (mail.ParseAddress); cifrado
- message: email is not a valid address
  condition: 'isNull(email) || decrypt(email,$DATA_SECRET_KEY) == "" || test(decrypt(email,$DATA_SECRET_KEY),"^[^@\s]+@[^@\s]+\.[^@\s]+$")'
# Go: customers/internal/customer/application/usecases/portal.go:1019 (E.164); cifrado
- message: phone is + and 7 to 15 digits (E.164)
  condition: 'isNull(phone) || decrypt(phone,$DATA_SECRET_KEY) == "" || test(decrypt(phone,$DATA_SECRET_KEY),"^\+[1-9][0-9]{6,14}$")'
# nueva
- message: website is an http(s) URL
  condition: 'isNull(website) || website == "" || test(website,"^https?://[^\s/$.?#][^\s]*$")'
# nueva
- message: countryCode is three capital letters (ISO 3166-1 alpha-3)
  condition: 'isNull(countryCode) || test(countryCode,"^[A-Z]{3}$")'
```

### CompanyBranches

```yaml
constraints:
# Go: contact.go:79; cifrado
- message: email is not a valid address
  condition: 'isNull(email) || decrypt(email,$DATA_SECRET_KEY) == "" || test(decrypt(email,$DATA_SECRET_KEY),"^[^@\s]+@[^@\s]+\.[^@\s]+$")'
# Go: portal.go:1019; cifrado
- message: phone is + and 7 to 15 digits (E.164)
  condition: 'isNull(phone) || decrypt(phone,$DATA_SECRET_KEY) == "" || test(decrypt(phone,$DATA_SECRET_KEY),"^\+[1-9][0-9]{6,14}$")'
# Go: customers/…/usecases/customer.go:568; cifrado
- message: positionLatitude is between -90 and 90
  condition: 'isNull(positionLatitude) || (toNumber(decrypt(positionLatitude,$DATA_SECRET_KEY)) >= -90 && toNumber(decrypt(positionLatitude,$DATA_SECRET_KEY)) <= 90)'
# Go: customer.go:569; cifrado
- message: positionLongitude is between -180 and 180
  condition: 'isNull(positionLongitude) || (toNumber(decrypt(positionLongitude,$DATA_SECRET_KEY)) >= -180 && toNumber(decrypt(positionLongitude,$DATA_SECRET_KEY)) <= 180)'
# nueva
- message: addressCountryCode is three capital letters (ISO 3166-1 alpha-3)
  condition: 'isNull(addressCountryCode) || test(addressCountryCode,"^[A-Z]{3}$")'
```

### CompanyBrands

```yaml
constraints:
# Go: customers/…/usecases/brand.go:47
- message: 'primaryColor is #rrggbb'
  condition: 'isNull(primaryColor) || test(primaryColor,"^#[0-9a-fA-F]{6}$")'
# Go: brand.go:47
- message: 'accentColor is #rrggbb'
  condition: 'isNull(accentColor) || test(accentColor,"^#[0-9a-fA-F]{6}$")'
```

### CompanyDocuments

```yaml
constraints:
# CHECK crm_company_documents
- message: status is pending, verified or rejected
  condition: 'isNull(status) || status.in(["pending","verified","rejected"])'
# CHECK crm_company_documents
- message: reminderStage is 60d, 30d, 7d or expired
  condition: 'isNull(reminderStage) || reminderStage.in(["60d","30d","7d","expired"])'
# nueva
- message: size is not negative
  condition: 'isNull(size) || size >= 0'
```

### CompanyIdentities

```yaml
constraints:
# CHECK crm_company_identities
- message: companyRole is admin, installer or hr
  condition: 'isNull(companyRole) || companyRole.in(["admin","installer","hr"])'
```

### CompanyPartnerships

```yaml
constraints:
# CHECK crm_company_partnerships
- message: status is requested, active, declined or ended
  condition: 'isNull(status) || status.in(["requested","active","declined","ended"])'
# CHECK crm_company_partnerships
- message: modality is subcontract or coordinated
  condition: 'isNull(modality) || modality.in(["subcontract","coordinated"])'
```

### CompanyPrices

```yaml
constraints:
# CHECK crm_company_prices
- message: kind is device or labour
  condition: 'isNull(kind) || kind.in(["device","labour"])'
# CHECK crm_company_prices: device lleva deviceModelId y no workId; labour al revés
- message: a device price has deviceModelId and no workId; a labour price, workId and no deviceModelId
  condition: 'isNull(kind) || (kind == "device" && isNotNull(deviceModelId) && isNull(workId)) || (kind == "labour" && isNotNull(workId) && isNull(deviceModelId))'
# nueva
- message: amount is not negative
  condition: 'isNull(amount) || amount >= 0'
```

### ContactMessages

```yaml
constraints:
# CHECK crm_contact_messages
- message: kind is customer, installationCompany or other
  condition: 'isNull(kind) || kind.in(["customer","installationCompany","other"])'
# CHECK crm_contact_messages
- message: status is new, answered or archived
  condition: 'isNull(status) || status.in(["new","answered","archived"])'
# CHECK crm_contact_messages
- message: mailStatus is pending, sent or failed
  condition: 'isNull(mailStatus) || mailStatus.in(["pending","sent","failed"])'
# Go: customers/internal/contact/application/usecases/contact.go:79; cifrado
- message: email is not a valid address
  condition: 'isNull(email) || decrypt(email,$DATA_SECRET_KEY) == "" || test(decrypt(email,$DATA_SECRET_KEY),"^[^@\s]+@[^@\s]+\.[^@\s]+$")'
# Go: portal.go:1019; cifrado
- message: phone is + and 7 to 15 digits (E.164)
  condition: 'isNull(phone) || decrypt(phone,$DATA_SECRET_KEY) == "" || test(decrypt(phone,$DATA_SECRET_KEY),"^\+[1-9][0-9]{6,14}$")'
# nueva
- message: mailAttempts is not negative
  condition: 'isNull(mailAttempts) || mailAttempts >= 0'
```

### Customers

```yaml
constraints:
# Go: contact.go:79; cifrado
- message: email is not a valid address
  condition: 'isNull(email) || decrypt(email,$DATA_SECRET_KEY) == "" || test(decrypt(email,$DATA_SECRET_KEY),"^[^@\s]+@[^@\s]+\.[^@\s]+$")'
# Go: portal.go:1019; cifrado
- message: phone is + and 7 to 15 digits (E.164)
  condition: 'isNull(phone) || decrypt(phone,$DATA_SECRET_KEY) == "" || test(decrypt(phone,$DATA_SECRET_KEY),"^\+[1-9][0-9]{6,14}$")'
# nueva
- message: countryCode is three capital letters (ISO 3166-1 alpha-3)
  condition: 'isNull(countryCode) || test(countryCode,"^[A-Z]{3}$")'
```

### Invitations

```yaml
constraints:
# CHECK crm_invitations
- message: kind is customer or companyMember
  condition: 'isNull(kind) || kind.in(["customer","companyMember"])'
# CHECK crm_invitations
- message: companyRole is admin, installer or hr
  condition: 'isNull(companyRole) || companyRole.in(["admin","installer","hr"])'
# Go: contact.go:79; cifrado
- message: email is not a valid address
  condition: 'isNull(email) || decrypt(email,$DATA_SECRET_KEY) == "" || test(decrypt(email,$DATA_SECRET_KEY),"^[^@\s]+@[^@\s]+\.[^@\s]+$")'
# nueva
- message: addressCountryCode is three capital letters (ISO 3166-1 alpha-3)
  condition: 'isNull(addressCountryCode) || test(addressCountryCode,"^[A-Z]{3}$")'
```

### Locations

```yaml
constraints:
# CHECK crm_locations
- message: installerStatus is pendingInstaller or installerAssigned
  condition: 'isNull(installerStatus) || installerStatus.in(["pendingInstaller","installerAssigned"])'
# CHECK crm_locations
- message: geoStatus is pendingGeoVerification or geoVerified
  condition: 'isNull(geoStatus) || geoStatus.in(["pendingGeoVerification","geoVerified"])'
# CHECK crm_locations
- message: geoSource is geocoder or map
  condition: 'isNull(geoSource) || geoSource.in(["geocoder","map"])'
# CHECK crm_locations
- message: installationStatus is notStarted, inProgress or installed
  condition: 'isNull(installationStatus) || installationStatus.in(["notStarted","inProgress","installed"])'
# Go: customer.go:568; cifrado
- message: positionLatitude is between -90 and 90
  condition: 'isNull(positionLatitude) || (toNumber(decrypt(positionLatitude,$DATA_SECRET_KEY)) >= -90 && toNumber(decrypt(positionLatitude,$DATA_SECRET_KEY)) <= 90)'
# Go: customer.go:569; cifrado
- message: positionLongitude is between -180 and 180
  condition: 'isNull(positionLongitude) || (toNumber(decrypt(positionLongitude,$DATA_SECRET_KEY)) >= -180 && toNumber(decrypt(positionLongitude,$DATA_SECRET_KEY)) <= 180)'
# nueva (la propuesta del cliente, mismo rango); cifrado
- message: proposedPositionLatitude is between -90 and 90
  condition: 'isNull(proposedPositionLatitude) || (toNumber(decrypt(proposedPositionLatitude,$DATA_SECRET_KEY)) >= -90 && toNumber(decrypt(proposedPositionLatitude,$DATA_SECRET_KEY)) <= 90)'
# nueva; cifrado
- message: proposedPositionLongitude is between -180 and 180
  condition: 'isNull(proposedPositionLongitude) || (toNumber(decrypt(proposedPositionLongitude,$DATA_SECRET_KEY)) >= -180 && toNumber(decrypt(proposedPositionLongitude,$DATA_SECRET_KEY)) <= 180)'
# nueva
- message: addressCountryCode is three capital letters (ISO 3166-1 alpha-3)
  condition: 'isNull(addressCountryCode) || test(addressCountryCode,"^[A-Z]{3}$")'
```

## iam

### CloudRoleScreens

```yaml
constraints:
# CHECK iam_cloud_role_screens
- message: access is remote, local, owner or none
  condition: 'isNull(access) || access.in(["remote","local","owner","none"])'
# CHECK iam_cloud_role_screens
- message: permission is all, editable or read
  condition: 'isNull(permission) || permission.in(["all","editable","read"])'
```

### Identities

```yaml
constraints:
# Go: contact.go:79; cifrado
- message: email is not a valid address
  condition: 'isNull(email) || decrypt(email,$DATA_SECRET_KEY) == "" || test(decrypt(email,$DATA_SECRET_KEY),"^[^@\s]+@[^@\s]+\.[^@\s]+$")'
# Go: portal.go:1019; cifrado
- message: phone is + and 7 to 15 digits (E.164)
  condition: 'isNull(phone) || decrypt(phone,$DATA_SECRET_KEY) == "" || test(decrypt(phone,$DATA_SECRET_KEY),"^\+[1-9][0-9]{6,14}$")'
# Go: customers/internal/customer/application/usecases/portal.go:993
- message: languageCode is up to 32 letters, digits, _ or -
  condition: 'isNull(languageCode) || test(languageCode,"^[A-Za-z0-9_-]{0,32}$")'
# Go: portal.go:993
- message: theme is up to 32 letters, digits, _ or -
  condition: 'isNull(theme) || test(theme,"^[A-Za-z0-9_-]{0,32}$")'
```

### PhoneVerifications

```yaml
constraints:
# Go: portal.go:1019; cifrado y required
- message: phone is + and 7 to 15 digits (E.164)
  condition: 'isNull(phone) || decrypt(phone,$DATA_SECRET_KEY) == "" || test(decrypt(phone,$DATA_SECRET_KEY),"^\+[1-9][0-9]{6,14}$")'
# nueva
- message: attempts is not negative
  condition: 'isNull(attempts) || attempts >= 0'
# nueva
- message: windowSends is not negative
  condition: 'isNull(windowSends) || windowSends >= 0'
```

## sales

### CountryTaxRates

```yaml
constraints:
# Go: catalog/internal/domain/entities/country.go:121
- message: kind is vat, surcharge or withholding
  condition: 'isNull(kind) || kind.in(["vat","surcharge","withholding"])'
# Go: country.go:125
- message: appliesTo is all, goods or services
  condition: 'isNull(appliesTo) || appliesTo.in(["all","goods","services"])'
# nueva
- message: rate is between 0 and 100
  condition: 'isNull(rate) || (rate >= 0 && rate <= 100)'
# nueva
- message: countryCode is three capital letters (ISO 3166-1 alpha-3)
  condition: 'isNull(countryCode) || test(countryCode,"^[A-Z]{3}$")'
```

### InstallationEvents

```yaml
constraints:
# Go: los valores de Installations.status (customers/…/usecases/installations.go)
- message: fromStatus is a status of an installation
  condition: 'isNull(fromStatus) || fromStatus == "" || fromStatus.in(["requested","assigned","inProgress","suspended","finished","closed","cancelled"])'
- message: toStatus is a status of an installation
  condition: 'isNull(toStatus) || toStatus == "" || toStatus.in(["requested","assigned","inProgress","suspended","finished","closed","cancelled"])'
```

### InstallationFiles

```yaml
constraints:
# CHECK sal_installation_files
- message: kind is photo, document or signature
  condition: 'isNull(kind) || kind.in(["photo","document","signature"])'
# CHECK sal_installation_files
- message: stage is start, during, finish or close
  condition: 'isNull(stage) || stage.in(["start","during","finish","close"])'
# nueva
- message: size is not negative
  condition: 'isNull(size) || size >= 0'
```

### Installations

```yaml
constraints:
# CHECK sal_installations
- message: kind is installation, extension, maintenance or uninstall
  condition: 'isNull(kind) || kind.in(["installation","extension","maintenance","uninstall"])'
# CHECK sal_installations
- message: status is requested, assigned, inProgress, suspended, finished, closed or cancelled
  condition: 'isNull(status) || status.in(["requested","assigned","inProgress","suspended","finished","closed","cancelled"])'
# CHECK sal_installations
- message: statusBeforeSuspension is requested, assigned or inProgress
  condition: 'isNull(statusBeforeSuspension) || statusBeforeSuspension.in(["requested","assigned","inProgress"])'
# CHECK sal_installations
- message: rating is between 1 and 5
  condition: 'isNull(rating) || (rating >= 1 && rating <= 5)'
# Go: customers/…/usecases/installations.go:246
- message: scheduledEnd is not before scheduledStart
  condition: 'isNull(scheduledStart) || isNull(scheduledEnd) || scheduledStart <= scheduledEnd'
# nueva
- message: finishedAt is not before startedAt
  condition: 'isNull(startedAt) || isNull(finishedAt) || startedAt <= finishedAt'
# nueva
- message: reopenCount is not negative
  condition: 'isNull(reopenCount) || reopenCount >= 0'
# Go: portal.go:1019; cifrado
- message: contactPhone is + and 7 to 15 digits (E.164)
  condition: 'isNull(contactPhone) || decrypt(contactPhone,$DATA_SECRET_KEY) == "" || test(decrypt(contactPhone,$DATA_SECRET_KEY),"^\+[1-9][0-9]{6,14}$")'
```

## sales — FerretDB

Sin CHECK en la base: estas reglas son su única validación.

### Quotes

```yaml
constraints:
# Go: customers/internal/domain/entities/quote.go:12
- message: status is draft, sent, accepted, rejected, expired or cancelled
  condition: 'isNull(status) || status.in(["draft","sent","accepted","rejected","expired","cancelled"])'
# Go: customers/…/usecases/quotes.go:208
- message: discountPercent is between 0 and 100
  condition: 'isNull(discountPercent) || (discountPercent >= 0 && discountPercent <= 100)'
# Go: quotes.go:298 (estrictamente después)
- message: validUntil is after issuedAt
  condition: 'isNull(issuedAt) || isNull(validUntil) || issuedAt < validUntil'
# nueva
- message: version is at least 1
  condition: 'isNull(version) || version >= 1'
```

### InstallationReports

```yaml
constraints:
# Go: installations.go:246 (la misma regla que la instalación)
- message: scheduledEnd is not before scheduledStart
  condition: 'isNull(scheduledStart) || isNull(scheduledEnd) || scheduledStart <= scheduledEnd'
# nueva
- message: finishedAt is not before startedAt
  condition: 'isNull(startedAt) || isNull(finishedAt) || startedAt <= finishedAt'
# nueva
- message: hoursWorked is not negative
  condition: 'isNull(hoursWorked) || hoursWorked >= 0'
```

## perception

### ScanJobs

```yaml
constraints:
# CHECK per_scan_jobs
- message: status is queued, running, uploading, done, failed or cancelled
  condition: 'isNull(status) || status.in(["queued","running","uploading","done","failed","cancelled"])'
# nueva
- message: finishedAt is not before startedAt
  condition: 'isNull(startedAt) || isNull(finishedAt) || startedAt <= finishedAt'
```

## iot_location

### AreaAutomationSlots

```yaml
constraints:
# CHECK loc_area_automation_slots
- message: slot is mode, scene or preset
  condition: 'isNull(slot) || slot.in(["mode","scene","preset"])'
# CHECK loc_area_automation_slots
- message: source is manual, process or schedule
  condition: 'isNull(source) || source.in(["manual","process","schedule"])'
```

### AreaCapabilityBindingDevices

```yaml
constraints:
# CHECK loc_area_capability_binding_devices
- message: origin is manual, auto or disabled
  condition: 'isNull(origin) || origin.in(["manual","auto","disabled"])'
```

### AreaCaseBindingTargets

```yaml
constraints:
# CHECK loc_area_case_binding_targets
- message: origin is manual, auto or disabled
  condition: 'isNull(origin) || origin.in(["manual","auto","disabled"])'
```

### AreaFiles

```yaml
constraints:
# CHECK loc_area_files
- message: role is scanPhoto, scanArtifact, objectCrop, localizationPhoto, planSource or planRectified
  condition: 'isNull(role) || role.in(["scanPhoto","scanArtifact","objectCrop","localizationPhoto","planSource","planRectified"])'
# CHECK loc_area_files
- message: status is pending, accepted or discarded
  condition: 'isNull(status) || status.in(["pending","accepted","discarded"])'
```

### AreaObjects

```yaml
constraints:
# CHECK loc_area_objects
- message: status is proposed, confirmed, rejected or stale
  condition: 'isNull(status) || status.in(["proposed","confirmed","rejected","stale"])'
# Go: location/internal/domain/entities/area_scan.go:140 (comentario)
- message: source is scan or photo
  condition: 'isNull(source) || source.in(["scan","photo"])'
```

### AreaOrderBindingDevices

```yaml
constraints:
# CHECK loc_area_order_binding_devices
- message: origin is manual, auto or disabled
  condition: 'isNull(origin) || origin.in(["manual","auto","disabled"])'
```

### AreaOrderBindings

```yaml
constraints:
# CHECK loc_area_order_bindings
- message: distribution is all, first, failover or oneByOne
  condition: 'isNull(distribution) || distribution.in(["all","first","failover","oneByOne"])'
```

### AreaScanPasses

```yaml
constraints:
# Go: area_scan.go:78 (comentario)
- message: kind is initial or complete
  condition: 'isNull(kind) || kind.in(["initial","complete"])'
```

### AreaScans

```yaml
constraints:
# CHECK loc_area_scans
- message: status is capturing, queued, processing, ready, incomplete, applied, discarded, failed or cancelled
  condition: 'isNull(status) || status.in(["capturing","queued","processing","ready","incomplete","applied","discarded","failed","cancelled"])'
# CHECK loc_area_scans
- message: scaleSource is unscaled, measure or existing
  condition: 'isNull(scaleSource) || scaleSource.in(["unscaled","measure","existing"])'
# Go: area_scan.go:60 (comentario)
- message: source is photos or import
  condition: 'isNull(source) || source.in(["photos","import"])'
```

### BiometricSamples

```yaml
constraints:
# CHECK loc_biometric_samples
- message: modality is face, voice or appearance
  condition: 'isNull(modality) || modality.in(["face","voice","appearance"])'
# nueva
- message: qualityScore is between 0 and 100
  condition: 'isNull(qualityScore) || (qualityScore >= 0 && qualityScore <= 100)'
# nueva
- message: vectorDim is greater than 0
  condition: 'isNull(vectorDim) || vectorDim > 0'
```

### DetectionEvents

```yaml
constraints:
# CHECK loc_detection_events
- message: result is known, unknown or unidentified
  condition: 'isNull(result) || result.in(["known","unknown","unidentified"])'
# nueva
- message: qualityScore is between 0 and 100
  condition: 'isNull(qualityScore) || (qualityScore >= 0 && qualityScore <= 100)'
```

### DeviceConnections

```yaml
constraints:
# Go: location/internal/devices/application/usecases/auto_register_device.go:390; cifrado
- message: macAddress is six pairs of hexadecimal digits separated by colons
  condition: 'isNull(macAddress) || decrypt(macAddress,$DATA_SECRET_KEY) == "" || test(decrypt(macAddress,$DATA_SECRET_KEY),"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")'
```

### DeviceLinks

```yaml
constraints:
# Go: catalog/internal/domain/entities/device.go:548 (comentario)
- message: modality is image or audio
  condition: 'isNull(modality) || modality == "" || modality.in(["image","audio"])'
```

### DeviceStateSamples

```yaml
constraints:
# CHECK loc_device_state_samples
- message: modality is image or audio
  condition: 'isNull(modality) || modality.in(["image","audio"])'
```

### FileAnalyses

```yaml
constraints:
# CHECK loc_file_analyses
- message: status is queued, running, done or failed
  condition: 'isNull(status) || status.in(["queued","running","done","failed"])'
# nueva
- message: finishedAt is not before startedAt
  condition: 'isNull(startedAt) || isNull(finishedAt) || startedAt <= finishedAt'
```

### FileHistory

```yaml
constraints:
# CHECK loc_file_history
- message: action is created, renamed, pinned, unpinned, replaced, trashed, restored, removed or reassigned
  condition: 'isNull(action) || action.in(["created","renamed","pinned","unpinned","replaced","trashed","restored","removed","reassigned"])'
```

### Files

```yaml
constraints:
# CHECK loc_files
- message: status is active, hidden or trashed
  condition: 'isNull(status) || status.in(["active","hidden","trashed"])'
# CHECK loc_files
- message: version is at least 1
  condition: 'isNull(version) || version >= 1'
# CHECK loc_files: si dice de qué tipo de entidad es, dice cuál
- message: entityType needs entityId
  condition: 'isNull(entityType) || isNotNull(entityId)'
# nueva
- message: sizeBytes is not negative
  condition: 'isNull(sizeBytes) || sizeBytes >= 0'
```

### FloorPlanAreaShapes

```yaml
constraints:
# Go: rules/thresholds.go:15 (el mismo formato de color)
- message: 'color is #rgb, #rrggbb or #rrggbbaa'
  condition: 'isNull(color) || color == "" || test(color,"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")'
```

### FloorPlanVersions

```yaml
constraints:
# CHECK loc_floor_plan_versions
- message: source is editor, scan, photo, restore or import
  condition: 'isNull(source) || source.in(["editor","scan","photo","restore","import"])'
```

### FloorPlanWalls

```yaml
constraints:
# CHECK loc_floor_plan_walls
- message: lengthSource is confirmed, scaled or estimated
  condition: 'isNull(lengthSource) || lengthSource.in(["confirmed","scaled","estimated"])'
```

### Integrations

```yaml
constraints:
# CHECK loc_integrations
- message: locationText is local or cloud
  condition: 'isNull(locationText) || locationText.in(["local","cloud"])'
# nueva
- message: helpUrl is an http(s) URL
  condition: 'isNull(helpUrl) || helpUrl == "" || test(helpUrl,"^https?://[^\s/$.?#][^\s]*$")'
```

### Notifications

```yaml
constraints:
# Go: location/internal/domain/entities/notification.go:14
- message: source is task or device
  condition: 'isNull(source) || source.in(["task","device"])'
```

### PlanImports

```yaml
constraints:
# CHECK loc_plan_imports
- message: status is draft, recognized, applied, saved or discarded
  condition: 'isNull(status) || status.in(["draft","recognized","applied","saved","discarded"])'
```

### ScheduledTaskEvents

```yaml
constraints:
# CHECK loc_scheduled_task_events
- message: event is onStart or onShutdown
  condition: 'isNull(event) || event.in(["onStart","onShutdown"])'
```

### ScheduledTasks

```yaml
constraints:
# CHECK loc_scheduled_tasks
- message: misfire is skip or runOnce
  condition: 'isNull(misfire) || misfire.in(["skip","runOnce"])'
```

### Subjects

```yaml
constraints:
# Go: contact.go:79; cifrado
- message: email is not a valid address
  condition: 'isNull(email) || decrypt(email,$DATA_SECRET_KEY) == "" || test(decrypt(email,$DATA_SECRET_KEY),"^[^@\s]+@[^@\s]+\.[^@\s]+$")'
```

### TaskSteps

```yaml
constraints:
# CHECK loc_task_steps
- message: state is running, stopped, finished, failed, canceled, killed or interrupted
  condition: 'isNull(state) || state.in(["running","stopped","finished","failed","canceled","killed","interrupted"])'
# nueva
- message: finishedAt is not before startedAt
  condition: 'isNull(startedAt) || isNull(finishedAt) || startedAt <= finishedAt'
```

### Tasks

```yaml
constraints:
# CHECK loc_tasks
- message: state is running, stopped, finished, failed, canceled, killed or interrupted
  condition: 'isNull(state) || state.in(["running","stopped","finished","failed","canceled","killed","interrupted"])'
# nueva
- message: finishedAt is not before startedAt
  condition: 'isNull(startedAt) || isNull(finishedAt) || startedAt <= finishedAt'
```

### Processes

```yaml
constraints:
# nueva (FerretDB: sin CHECK)
- message: endDate is not before startDate
  condition: 'isNull(startDate) || isNull(endDate) || startDate <= endDate'
```
