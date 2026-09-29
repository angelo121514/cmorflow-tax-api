import { DataSource, MigrationExecutor } from "typeorm";
import { CreateStandaloneTaxBase1804900000000 } from "./migrations/1804900000000-CreateStandaloneTaxBase";
import { AddIntegrationsApi1805000000000 } from "./migrations/1805000000000-AddIntegrationsApi";

describe("Standalone database base migration", () => {
  it("has a valid TypeORM timestamp and runs before the integrations schema", async () => {
    const connection = new DataSource({ type: "postgres" });
    connection.migrations.push(
      new AddIntegrationsApi1805000000000(),
      new CreateStandaloneTaxBase1804900000000(),
    );
    const migrations = await new MigrationExecutor(
      connection,
    ).getAllMigrations();
    expect(migrations.map((migration) => migration.name)).toEqual([
      "CreateStandaloneTaxBase1804900000000",
      "AddIntegrationsApi1805000000000",
    ]);
  });

  it("refuses automatic rollback without issuing destructive SQL on shared tables", async () => {
    const query = jest.fn();
    await expect(
      new CreateStandaloneTaxBase1804900000000().down({ query } as any),
    ).rejects.toThrow(/rollback destructivo/);
    expect(query).not.toHaveBeenCalled();
  });
});
