import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

const hasCurrentSchema = (client: PrismaClient | undefined) => {
  const productSliderFields = (
    client as
      | (PrismaClient & {
          _runtimeDataModel?: {
            models?: {
              ProductSliderSetting?: {
                fields?: Array<{ name: string }>;
              };
            };
          };
        })
      | undefined
  )?._runtimeDataModel?.models?.ProductSliderSetting?.fields;

  return Boolean(
    client &&
      "productSliderSetting" in client &&
      typeof client.productSliderSetting?.findUnique === "function" &&
      // Tracks the newest column, so a client generated before it is treated as stale.
      productSliderFields?.some((field) => field.name === "carouselNavigation") &&
      // Field checks alone miss a newly added *model*, which is how a stale client
      // survives `prisma generate` and then throws on first use.
      "galleryStat" in client,
  );
};

if (process.env.NODE_ENV !== "production") {
  if (!hasCurrentSchema(global.prismaGlobal)) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
