/**
 * Completes and verifies the public OpenAPI contract in one place. The same
 * transformation is applied to the runtime Swagger document and CI baseline.
 */

type AuthKind = "hmac" | "cron" | "signed-token" | "public";
interface OperationContract {
  auth: AuthKind;
  permission?: string;
  success: number;
  errors?: number[];
  response: string;
  description: string;
  idempotency?: boolean;
  bodyRequired?: boolean;
}

const operations: Record<string, OperationContract> = {
  "POST /api/v1/dtes": {
    auth: "hmac",
    permission: "dte:emit",
    success: 202,
    errors: [400, 401, 403, 404, 409, 422, 429, 500],
    response: "QueuedRequest",
    description:
      "Emisión asíncrona; la clave de idempotencia debe ser no vacía.",
    idempotency: true,
    bodyRequired: true,
  },
  "GET /api/v1/dtes": {
    auth: "hmac",
    permission: "dte:read",
    success: 200,
    errors: [400, 401, 403, 404, 429, 500],
    response: "IntegrationRequestStatus",
    description:
      "Consulta por externalReference dentro del tenant autenticado.",
  },
  "GET /api/v1/dtes/{id}": {
    auth: "hmac",
    permission: "dte:read",
    success: 200,
    errors: [401, 403, 404, 429, 500],
    response: "IntegrationRequestStatus",
    description:
      "Consulta por requestId o dteId dentro del tenant autenticado.",
  },
  "POST /api/v1/dtes/{dteId}/credit-notes": {
    auth: "hmac",
    permission: "dte:emit",
    success: 202,
    errors: [400, 401, 403, 404, 409, 422, 429, 500],
    response: "QueuedRequest",
    description:
      "Emisión de nota de crédito referenciada; Idempotency-Key no vacía.",
    idempotency: true,
    bodyRequired: true,
  },
  "POST /api/v1/dtes/{dteId}/debit-notes": {
    auth: "hmac",
    permission: "dte:emit",
    success: 202,
    errors: [400, 401, 403, 404, 409, 422, 429, 500],
    response: "QueuedRequest",
    description:
      "Emisión de nota de débito referenciada; Idempotency-Key no vacía.",
    idempotency: true,
    bodyRequired: true,
  },
  "GET /api/v1/dtes/{dteId}/xml": {
    auth: "hmac",
    permission: "artifacts:read",
    success: 200,
    errors: [401, 403, 404, 429, 500],
    response: "Xml",
    description: "Devuelve el XML firmado como descarga.",
  },
  "GET /api/v1/dtes/{dteId}/pdf": {
    auth: "hmac",
    permission: "artifacts:read",
    success: 200,
    errors: [401, 403, 404, 429, 500],
    response: "Pdf",
    description: "Devuelve el PDF como descarga.",
  },
  "POST /api/v1/dtes/{dteId}/artifact-links": {
    auth: "hmac",
    permission: "artifacts:read",
    success: 201,
    errors: [401, 403, 404, 429, 500],
    response: "ArtifactLinks",
    description: "Crea URLs firmadas de corta duración para XML y PDF.",
  },
  "POST /api/v1/rcof": {
    auth: "hmac",
    permission: "rcof:submit",
    success: 202,
    errors: [400, 401, 403, 409, 422, 429, 500],
    response: "QueuedRequest",
    description: "Encola RCOF manual; Idempotency-Key no vacía.",
    idempotency: true,
    bodyRequired: true,
  },
  "GET /api/v1/rcof/{id}": {
    auth: "hmac",
    permission: "rcof:read",
    success: 200,
    errors: [401, 403, 404, 429, 500],
    response: "RcofStatus",
    description: "Consulta la solicitud durable o la submission RCOF por ID.",
  },
  "POST /api/v1/credentials": {
    auth: "hmac",
    permission: "credentials:write",
    success: 201,
    errors: [400, 401, 403, 409, 422, 429, 500],
    response: "CredentialSecretResult",
    description:
      "Operación administrativa. El secreto sólo se devuelve al crearlo.",
    bodyRequired: true,
  },
  "GET /api/v1/credentials": {
    auth: "hmac",
    permission: "credentials:read",
    success: 200,
    errors: [401, 403, 429, 500],
    response: "CredentialList",
    description:
      "Operación administrativa; las credenciales se devuelven enmascaradas.",
  },
  "POST /api/v1/credentials/{id}/rotate": {
    auth: "hmac",
    permission: "credentials:write",
    success: 201,
    errors: [401, 403, 404, 422, 429, 500],
    response: "CredentialSecretResult",
    description:
      "Operación administrativa; el nuevo secreto sólo se devuelve una vez.",
  },
  "POST /api/v1/credentials/{id}/revoke": {
    auth: "hmac",
    permission: "credentials:write",
    success: 201,
    errors: [401, 403, 404, 422, 429, 500],
    response: "Revoked",
    description: "Operación administrativa.",
  },
  "POST /api/v1/webhooks": {
    auth: "hmac",
    permission: "webhooks:write",
    success: 201,
    errors: [400, 401, 403, 422, 429, 500],
    response: "WebhookSecretResult",
    description:
      "Operación administrativa; el secreto sólo se devuelve al crearlo.",
    bodyRequired: true,
  },
  "GET /api/v1/webhooks": {
    auth: "hmac",
    permission: "webhooks:read",
    success: 200,
    errors: [401, 403, 429, 500],
    response: "WebhookList",
    description: "Operación administrativa; requiere credencial admin.",
  },
  "POST /api/v1/webhooks/{id}/deactivate": {
    auth: "hmac",
    permission: "webhooks:write",
    success: 201,
    errors: [401, 403, 404, 422, 429, 500],
    response: "Deactivated",
    description: "Operación administrativa.",
  },
  "POST /api/v1/webhooks/events/{eventId}/redeliver": {
    auth: "hmac",
    permission: "webhooks:write",
    success: 201,
    errors: [401, 403, 404, 422, 429, 500],
    response: "QueuedCount",
    description: "Operación administrativa; crea entregas de webhook nuevas.",
  },
  "GET /api/v1/webhooks/deliveries": {
    auth: "hmac",
    permission: "webhooks:read",
    success: 200,
    errors: [401, 403, 429, 500],
    response: "WebhookDeliveryList",
    description: "Operación administrativa; requiere credencial admin.",
  },
  "GET /api/v1/artifacts/{token}": {
    auth: "signed-token",
    success: 200,
    errors: [404, 500],
    response: "Artifact",
    description:
      "La autorización está dentro del token firmado; no requiere HMAC ni Bearer.",
  },
  "POST /api/v1/internal/cron/process-integrations": {
    auth: "cron",
    success: 200,
    errors: [401, 500],
    response: "CronResult",
    description: "Endpoint interno autenticado con HMAC de cron.",
  },
  "POST /api/v1/internal/cron/deliver-webhooks": {
    auth: "cron",
    success: 200,
    errors: [401, 500],
    response: "CronResult",
    description: "Endpoint interno autenticado con HMAC de cron.",
  },
  "POST /api/v1/internal/cron/rcof-daily": {
    auth: "cron",
    success: 200,
    errors: [401, 500],
    response: "CronResult",
    description:
      "Endpoint interno autenticado con HMAC de cron; encola RCOF diarios durablemente.",
  },
  "GET /api/v1/health": {
    auth: "public",
    success: 200,
    errors: [500],
    response: "Health",
    description: "Liveness público.",
  },
  "GET /api/v1/ready": {
    auth: "public",
    success: 200,
    errors: [500, 503],
    response: "Readiness",
    description: "Readiness público; puede responder 503 cuando no está listo.",
  },
  "POST /api/v1/configuration/caf": {
    auth: "hmac",
    permission: "credentials:write",
    success: 201,
    errors: [400, 401, 403, 404, 422, 429, 500],
    response: "CafUploadResult",
    description: "Operación administrativa de configuración tributaria.",
    bodyRequired: true,
  },
  "POST /api/v1/configuration/signature": {
    auth: "hmac",
    permission: "credentials:write",
    success: 201,
    errors: [400, 401, 403, 422, 429, 500],
    response: "SignatureResult",
    description: "Operación administrativa; el certificado se cifra en reposo.",
    bodyRequired: true,
  },
  "GET /api/v1/configuration/folios": {
    auth: "hmac",
    permission: "credentials:read",
    success: 200,
    errors: [401, 403, 429, 500],
    response: "FolioStockList",
    description: "Consulta administrativa de folios CAF.",
  },
  "GET /api/v1/configuration/branding": {
    auth: "hmac",
    permission: "credentials:read",
    success: 200,
    errors: [401, 403, 429, 500],
    response: "InvoiceBrandingMetadataDto",
    description: "Consulta administrativa de marca visual.",
  },
  "PUT /api/v1/configuration/branding": {
    auth: "hmac",
    permission: "credentials:write",
    success: 200,
    errors: [400, 401, 403, 422, 429, 500],
    response: "InvoiceBrandingMetadataDto",
    description: "Actualización administrativa versionada de marca visual.",
    bodyRequired: true,
  },
  "GET /api/v1/configuration/branding/logo": {
    auth: "hmac",
    permission: "credentials:read",
    success: 200,
    errors: [401, 403, 404, 429, 500],
    response: "Png",
    description: "Logo privado de la versión visual activa.",
  },
};

const errorSchema = { $ref: "#/components/schemas/ApiErrorResponse" };

export function completeOpenApiContract(document: any): any {
  document.components ||= {};
  document.components.securitySchemes ||= {};
  Object.assign(document.components.securitySchemes, {
    "integration-hmac": {
      type: "apiKey",
      in: "header",
      name: "X-Api-Key",
      description:
        "Credencial pública; se usa junto con timestamp, nonce y firma HMAC.",
    },
    "integration-timestamp": {
      type: "apiKey",
      in: "header",
      name: "X-Timestamp",
    },
    "integration-nonce": { type: "apiKey", in: "header", name: "X-Nonce" },
    "integration-signature": {
      type: "apiKey",
      in: "header",
      name: "X-Signature",
      description: "HMAC-SHA256 del string canónico.",
    },
    "cron-timestamp": {
      type: "apiKey",
      in: "header",
      name: "X-Cron-Timestamp",
    },
    "cron-nonce": { type: "apiKey", in: "header", name: "X-Cron-Nonce" },
    "cron-signature": {
      type: "apiKey",
      in: "header",
      name: "X-Cron-Signature",
      description: "HMAC-SHA256 del body crudo con CRON_HMAC_SECRET.",
    },
  });
  document.components.schemas ||= {};
  Object.assign(document.components.schemas, schemas);

  const seen = new Set<string>();
  for (const [path, pathItem] of Object.entries<any>(document.paths || {})) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const key = `${method.toUpperCase()} ${path}`;
      const contract = operations[key];
      if (!contract)
        throw new Error(`OpenAPI contiene operación sin contrato SDD: ${key}`);
      if (operation["x-auth-type"] !== contract.auth) {
        throw new Error(
          `${key}: auth en controller (${operation["x-auth-type"] || "sin declarar"}) no coincide con contrato (${contract.auth}).`,
        );
      }
      const declaredPermissions = operation["x-required-permissions"];
      const expectedPermissions = contract.permission
        ? [contract.permission]
        : [];
      if (
        JSON.stringify(declaredPermissions || []) !==
        JSON.stringify(expectedPermissions)
      ) {
        throw new Error(
          `${key}: permisos del controller (${JSON.stringify(declaredPermissions || [])}) no coinciden con contrato (${JSON.stringify(expectedPermissions)}).`,
        );
      }
      seen.add(key);
      operation.responses ||= {};
      operation.responses[String(contract.success)] ||= {
        description: "Respuesta exitosa.",
      };
      const success = operation.responses[String(contract.success)];
      if (!success.description) success.description = "Respuesta exitosa.";
      const responseContent = (success.content ||= {});
      for (const [mediaType, schema] of Object.entries<any>(
        mediaTypes(contract.response),
      )) {
        responseContent[mediaType] ||= { schema };
        responseContent[mediaType].schema ||= schema;
      }
      for (const status of contract.errors || []) {
        const response = (operation.responses[String(status)] ||= {
          description: errorDescription(status),
        });
        response.description ||= errorDescription(status);
        response.content ||= {};
        response.content["application/json"] ||= { schema: errorSchema };
        response.content["application/json"].schema ||= errorSchema;
      }

      operation.security = securityFor(contract.auth);
      operation.description = [
        operation.description,
        contract.description,
        contract.permission
          ? `Permiso requerido: \`${contract.permission}\`.`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      if (contract.idempotency) {
        operation.parameters ||= [];
        const alreadyDeclared = operation.parameters.some(
          (parameter: any) =>
            parameter.in === "header" &&
            parameter.name?.toLowerCase() === "idempotency-key",
        );
        if (!alreadyDeclared)
          operation.parameters.push({
            name: "Idempotency-Key",
            in: "header",
            required: true,
            description:
              "Cadena no vacía, limitada sólo por la capacidad del almacenamiento. Reutilizar la clave con un body distinto devuelve 409.",
            schema: { type: "string", minLength: 1 },
          });
      }
      operation.parameters ||= [];
      for (const match of path.matchAll(/\{([^}]+)\}/g)) {
        const name = match[1];
        if (
          !operation.parameters.some(
            (parameter: any) =>
              parameter.in === "path" && parameter.name === name,
          )
        ) {
          operation.parameters.push({
            name,
            in: "path",
            required: true,
            schema: {
              type: "string",
              ...(name === "token" ? {} : { format: "uuid" }),
            },
          });
        }
      }
      if (key === "GET /api/v1/dtes") {
        const externalReference = operation.parameters.find(
          (parameter: any) =>
            parameter.in === "query" && parameter.name === "externalReference",
        );
        if (externalReference) externalReference.required = true;
        else
          operation.parameters.push({
            name: "externalReference",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1 },
          });
      }
      if (contract.bodyRequired && operation.requestBody)
        operation.requestBody.required = true;
      if (contract.bodyRequired && !operation.requestBody)
        throw new Error(
          `${key}: el controller tiene body requerido pero OpenAPI no documenta requestBody.`,
        );
    }
  }

  const missing = Object.keys(operations).filter((key) => !seen.has(key));
  if (missing.length)
    throw new Error(
      `OpenAPI no contiene operaciones documentadas: ${missing.join(", ")}`,
    );
  return document;
}

export function assertCompleteOpenApiContract(document: any): void {
  for (const [path, pathItem] of Object.entries<any>(document.paths || {})) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const key = `${method.toUpperCase()} ${path}`;
      if (!Object.prototype.hasOwnProperty.call(operation, "security"))
        throw new Error(
          `${key}: falta declarar security (usar [] para rutas públicas).`,
        );
      if (
        !operation.responses ||
        !Object.keys(operation.responses).some((status) =>
          /^2\d\d$/.test(status),
        )
      )
        throw new Error(`${key}: falta response exitoso.`);
      const success = Object.entries<any>(operation.responses).find(
        ([status]) => /^2\d\d$/.test(status),
      )?.[1];
      if (
        !success?.content ||
        !Object.values<any>(success.content).some((media: any) => media.schema)
      )
        throw new Error(`${key}: response exitoso no tiene media type/schema.`);
      for (const media of Object.values<any>(success.content))
        assertResponseSchema(document, media.schema, key);
      if (
        operation.requestBody &&
        !Object.values<any>(operation.requestBody.content || {}).some(
          (media: any) => media.schema,
        )
      )
        throw new Error(`${key}: requestBody no tiene schema.`);
      if (
        !operation["x-required-permissions"] &&
        operation.security.length > 0 &&
        !operation.security[0]["cron-timestamp"]
      )
        throw new Error(`${key}: falta x-required-permissions.`);
      if (
        operation["x-required-permissions"] &&
        !operation.description?.includes(
          `Permiso requerido: \`${operation["x-required-permissions"][0]}\`.`,
        )
      )
        throw new Error(`${key}: permiso ausente de la descripción.`);
      if (
        operation.responses["400"] ||
        operation.responses["401"] ||
        operation.responses["403"] ||
        operation.responses["404"] ||
        operation.responses["409"] ||
        operation.responses["422"]
      ) {
        const hasErrorSchema = Object.values<any>(operation.responses)
          .filter((response: any) => response.content)
          .some(
            (response: any) =>
              response.content["application/json"]?.schema?.$ref ===
              "#/components/schemas/ApiErrorResponse",
          );
        if (!hasErrorSchema)
          throw new Error(`${key}: los errores no declaran ApiErrorResponse.`);
      }
    }
  }
}

function assertResponseSchema(
  document: any,
  schema: any,
  operation: string,
  visited = new Set<string>(),
): void {
  if (!schema) throw new Error(`${operation}: falta schema de respuesta.`);
  if (schema.$ref) {
    if (visited.has(schema.$ref)) return;
    visited.add(schema.$ref);
    if (!schema.$ref.startsWith("#/"))
      throw new Error(`${operation}: referencia externa no verificada.`);
    const resolved = schema.$ref
      .slice(2)
      .split("/")
      .reduce(
        (node: any, part: string) =>
          node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")],
        document,
      );
    if (!resolved)
      throw new Error(`${operation}: referencia inexistente ${schema.$ref}.`);
    assertResponseSchema(document, resolved, operation, visited);
    return;
  }
  for (const variant of [
    ...(schema.oneOf || []),
    ...(schema.anyOf || []),
    ...(schema.allOf || []),
  ]) {
    assertResponseSchema(document, variant, operation, new Set(visited));
  }
  if (schema.type === "array")
    assertResponseSchema(document, schema.items, operation, visited);
  if (
    schema.type === "object" &&
    !Object.keys(schema.properties || {}).length
  ) {
    throw new Error(
      `${operation}: objeto de respuesta genérico sin campos declarados.`,
    );
  }
}

function securityFor(auth: AuthKind): any[] {
  if (auth === "hmac")
    return [
      {
        "integration-hmac": [],
        "integration-timestamp": [],
        "integration-nonce": [],
        "integration-signature": [],
      },
    ];
  if (auth === "cron")
    return [{ "cron-timestamp": [], "cron-nonce": [], "cron-signature": [] }];
  return [];
}

function errorDescription(status: number): string {
  return (
    (
      {
        400: "Solicitud inválida o headers obligatorios ausentes.",
        401: "Autenticación inválida o faltante.",
        403: "La credencial no tiene el permiso requerido o el tenant no corresponde.",
        404: "Recurso no encontrado dentro del tenant.",
        409: "Conflicto de idempotencia o unicidad de negocio.",
        422: "La solicitud no cumple validaciones de dominio o tributarias.",
        429: "Límite de solicitudes excedido.",
        500: "Error interno del servidor.",
        503: "Servicio temporalmente no disponible.",
      } as Record<number, string>
    )[status] || "Error de solicitud."
  );
}

function mediaTypes(response: string): Record<string, any> {
  if (response === "Xml")
    return { "application/xml": { type: "string", format: "xml" } };
  if (response === "Pdf")
    return { "application/pdf": { type: "string", format: "binary" } };
  if (response === "Png")
    return { "image/png": { type: "string", format: "binary" } };
  if (response === "Artifact")
    return {
      "application/xml": { type: "string", format: "xml" },
      "application/pdf": { type: "string", format: "binary" },
    };
  const schema =
    response === "RcofStatus"
      ? {
          oneOf: [
            { $ref: "#/components/schemas/IntegrationRequestStatus" },
            { $ref: "#/components/schemas/RcofSubmissionStatus" },
          ],
        }
      : response === "FolioStockList"
        ? { type: "array", items: { $ref: "#/components/schemas/FolioStock" } }
        : response === "CredentialList" ||
            response === "WebhookList" ||
            response === "WebhookDeliveryList"
          ? {
              type: "array",
              items: {
                $ref: `#/components/schemas/${response === "CredentialList" ? "CredentialInfo" : response === "WebhookList" ? "WebhookEndpoint" : "WebhookDelivery"}`,
              },
            }
          : { $ref: `#/components/schemas/${response}` };
  return { "application/json": schema };
}

const schemas: Record<string, any> = {
  ApiErrorResponse: {
    type: "object",
    required: ["statusCode", "error"],
    properties: {
      statusCode: { type: "integer", example: 422 },
      error: {
        oneOf: [
          {
            type: "object",
            properties: {
              code: { type: "string" },
              message: {
                oneOf: [
                  { type: "string" },
                  { type: "array", items: { type: "string" } },
                ],
              },
            },
            additionalProperties: true,
          },
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
      message: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
      code: { type: "string" },
    },
    additionalProperties: true,
  },
  QueuedRequest: {
    type: "object",
    required: ["requestId", "kind", "status", "message", "_links"],
    properties: {
      requestId: { type: "string", format: "uuid" },
      dteId: { type: "string", format: "uuid", nullable: true },
      kind: {
        type: "string",
        enum: ["dte", "credit-note", "debit-note", "rcof"],
      },
      status: { type: "string", enum: ["queued"] },
      externalReference: { type: "string", nullable: true },
      message: { type: "string" },
      _links: {
        type: "object",
        properties: {
          self: { type: "string", example: "/api/v1/dtes/{requestId}" },
        },
        required: ["self"],
      },
    },
  },
  IntegrationRequestStatus: {
    type: "object",
    required: ["requestId", "kind", "status", "attempts", "_links"],
    properties: {
      requestId: { type: "string", format: "uuid" },
      kind: { type: "string" },
      status: {
        type: "string",
        enum: [
          "queued",
          "processing",
          "submitted",
          "accepted",
          "observed",
          "rejected",
          "failed",
          "cancelled",
        ],
      },
      externalReference: { type: "string", nullable: true },
      metadata: { type: "object", nullable: true, additionalProperties: true },
      dte: { type: "object", nullable: true, additionalProperties: true },
      rcof: { type: "object", nullable: true, additionalProperties: true },
      error: { type: "object", nullable: true, additionalProperties: true },
      attempts: { type: "integer" },
      createdAt: { type: "string", format: "date-time" },
      submittedAt: { type: "string", format: "date-time", nullable: true },
      finalizedAt: { type: "string", format: "date-time", nullable: true },
      _links: { type: "object", additionalProperties: { type: "string" } },
    },
  },
  RcofSubmissionStatus: {
    type: "object",
    required: ["rcofId", "periodDate", "sequence", "status"],
    properties: {
      rcofId: { type: "string", format: "uuid" },
      periodDate: { type: "string", format: "date" },
      sequence: { type: "integer" },
      status: {
        type: "string",
        enum: ["submitted", "accepted", "observed", "rejected", "failed"],
      },
      trackId: { type: "string", nullable: true },
      siiResponse: {
        type: "object",
        nullable: true,
        additionalProperties: true,
      },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  ArtifactLinks: {
    type: "object",
    required: ["xmlUrl", "pdfUrl", "expiresAt"],
    properties: {
      xmlUrl: { type: "string", format: "uri" },
      pdfUrl: { type: "string", format: "uri" },
      expiresAt: { type: "string", format: "date-time" },
    },
  },
  CredentialInfo: {
    type: "object",
    additionalProperties: true,
    properties: {
      id: { type: "string", format: "uuid" },
      keyId: { type: "string" },
      name: { type: "string" },
      credentialType: { type: "string", enum: ["api", "admin"] },
      permissions: { type: "array", items: { type: "string" } },
      status: { type: "string" },
      expiresAt: { type: "string", format: "date-time", nullable: true },
    },
  },
  CredentialSecretResult: {
    type: "object",
    required: ["credential", "secret"],
    properties: {
      credential: { $ref: "#/components/schemas/CredentialInfo" },
      secret: { type: "string", description: "Visible una sola vez." },
    },
  },
  Revoked: {
    type: "object",
    required: ["revoked"],
    properties: { revoked: { type: "boolean", example: true } },
  },
  WebhookEndpoint: {
    type: "object",
    additionalProperties: true,
    properties: {
      id: { type: "string", format: "uuid" },
      url: { type: "string", format: "uri" },
      events: { type: "array", items: { type: "string" } },
      active: { type: "boolean" },
      secretLast4: { type: "string" },
    },
  },
  WebhookSecretResult: {
    type: "object",
    required: ["endpoint", "secret"],
    properties: {
      endpoint: { $ref: "#/components/schemas/WebhookEndpoint" },
      secret: { type: "string", description: "Visible una sola vez." },
    },
  },
  WebhookDelivery: {
    type: "object",
    additionalProperties: true,
    properties: {
      id: { type: "string", format: "uuid" },
      eventId: { type: "string", format: "uuid" },
      status: { type: "string" },
      attempt: { type: "integer" },
      responseStatus: { type: "integer", nullable: true },
      nextAttemptAt: { type: "string", format: "date-time" },
    },
  },
  Deactivated: {
    type: "object",
    required: ["deactivated"],
    properties: { deactivated: { type: "boolean", example: true } },
  },
  QueuedCount: {
    type: "object",
    required: ["queued"],
    properties: { queued: { type: "integer", minimum: 0 } },
  },
  CronResult: {
    type: "object",
    required: ["job", "ok"],
    properties: {
      job: { type: "string" },
      ok: { type: "boolean" },
      error: { type: "string" },
    },
  },
  Health: {
    type: "object",
    required: ["status", "timestamp"],
    properties: {
      status: { type: "string", example: "ok" },
      timestamp: { type: "string", format: "date-time" },
    },
  },
  Readiness: {
    type: "object",
    required: ["status", "checks", "timestamp"],
    properties: {
      status: { type: "string", enum: ["ready", "not_ready"] },
      checks: { type: "object", additionalProperties: { type: "string" } },
      timestamp: { type: "string", format: "date-time" },
    },
  },
  CafUploadResult: {
    type: "object",
    required: ["success", "message", "caf"],
    properties: {
      success: { type: "boolean", example: true },
      message: { type: "string" },
      caf: {
        type: "object",
        required: ["type", "rangeFrom", "rangeTo", "authorizationDate"],
        properties: {
          type: { type: "integer", example: 33 },
          rangeFrom: { type: "integer" },
          rangeTo: { type: "integer" },
          authorizationDate: { type: "string", format: "date" },
        },
      },
    },
  },
  SignatureResult: {
    type: "object",
    required: ["success", "message", "subjectName", "validTo", "fingerprint"],
    properties: {
      success: { type: "boolean", example: true },
      message: { type: "string" },
      subjectName: { type: "string" },
      validTo: { type: "string", format: "date-time" },
      fingerprint: { type: "string" },
    },
  },
  FolioStock: {
    type: "object",
    required: [
      "type",
      "hasCaf",
      "totalAuthorized",
      "utilized",
      "remaining",
      "alert",
      "threshold",
    ],
    properties: {
      type: { type: "integer", enum: [33, 34, 39, 41, 46, 52, 56, 61] },
      hasCaf: { type: "boolean" },
      totalAuthorized: { type: "integer" },
      utilized: { type: "integer" },
      remaining: { type: "integer" },
      alert: { type: "string", enum: ["SALUDABLE", "ADVERTENCIA", "CRITICO"] },
      threshold: {
        type: "integer",
        description: "Umbral de alerta expresado como porcentaje.",
        example: 20,
      },
    },
  },
};
