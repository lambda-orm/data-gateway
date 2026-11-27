---
'@lambdaorm/data-gateway-client-node': patch
---

The package can be imported from an ES module (`import { connect } from '@lambdaorm/data-gateway-client-node'`): its
`exports` said only `require`, so `import` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
