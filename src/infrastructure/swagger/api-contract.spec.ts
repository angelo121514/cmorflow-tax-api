import { assertCompleteOpenApiContract } from "./api-contract";

function document(schema: any) {
  return {
    paths: {
      "/example": {
        get: {
          security: [],
          responses: {
            "200": { content: { "application/json": { schema } } },
          },
        },
      },
    },
    components: { schemas: {} },
  };
}

describe("OpenAPI response contract validation", () => {
  it("rejects generic object responses that conceal the returned fields", () => {
    expect(() =>
      assertCompleteOpenApiContract(
        document({ type: "object", additionalProperties: true }),
      ),
    ).toThrow(/genérico sin campos/);
  });

  it("rejects unresolved references, including the items of an array response", () => {
    expect(() =>
      assertCompleteOpenApiContract(
        document({
          type: "array",
          items: { $ref: "#/components/schemas/MissingFolioStock" },
        }),
      ),
    ).toThrow(/referencia inexistente/);
  });

  it("accepts an explicit array of typed folio stock objects", () => {
    const example: any = document({
      type: "array",
      items: { $ref: "#/components/schemas/FolioStock" },
    });
    example.components.schemas.FolioStock = {
      type: "object",
      properties: {
        type: { type: "integer" },
        remaining: { type: "integer" },
        alert: { type: "string" },
      },
    };
    expect(() => assertCompleteOpenApiContract(example)).not.toThrow();
  });
});
