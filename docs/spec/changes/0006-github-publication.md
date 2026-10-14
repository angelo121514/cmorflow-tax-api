# Publicación GitHub MIT

## Problema y resultado esperado

MIT y las correcciones permanecían en PR; main no mostraba licencia reconocida. Se prepara la prerelease 1.0.0-oss.1 en el repositorio actual, con README/licencia visibles y despliegue manual independiente.

## Especificación y decisiones

El autor autorizó fusionar PR #2 por squash y publicar v1.0.0-oss.1 como prerelease tras CI aprobado. La publicación no despliega Render. Se verificó Auto-Deploy Off en el servicio asociado y ambos servicios Blueprint quedan manuales. SII/T46 y staging/ERP conservan gates externos.

## Criterios de aceptación

- [x] README explica MIT, requisitos, configuración, pruebas y límites tributarios.
- [x] Versión 1.0.0-oss.1 coherente en los dos manifiestos y changelog.
- [x] Blueprint declara despliegue manual y Render confirma Off antes de la fusión.
- [x] Gitleaks revisa contenido versionado e historial, con evidencia sin secretos.
- [ ] CI de la cabecera final y del commit squash aprueban antes del tag/release.
- [ ] GitHub main reconoce MIT y el despliegue Render previo no cambia.

## Pruebas y trazabilidad

Se ejecutan validaciones existentes y escaneo Gitleaks; no se cambia lógica tributaria ni contratos HTTP. Los resultados de publicación se registran en VALIDATION_REPORT y las notas de release.

```sdd
{
  "features": [
    "F-10"
  ],
  "specs": [
    "docs/spec/VALIDATION_REPORT.md",
    "docs/spec/IMPLEMENTATION_STATUS.md"
  ],
  "code": [
    "package.json",
    "package-lock.json",
    "render.yaml"
  ],
  "tests": [],
  "testExemption": "Sólo se cambia metadata de versión y despliegue automático a manual; CI existente comprueba build, contrato, SDD y YAML, sin lógica funcional nueva.",
  "removed": []
}
```

## Riesgos y responsables

Mantenedor verifica licencia, historial, SHA de merge/release y CI. Operaciones conserva Auto-Deploy Off. No se alteran otros servicios, secretos ni runtime desplegado. Si no puede verificarse Off, se detiene antes de fusionar. Certificación y emisión real requieren responsables externos.
