import { PrismaClient, UserRole, OrganizerStatus, EventStatus } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

async function main() {
  // Load contract addresses written by Deploy.s.sol
  let addresses = { nft: "", sale: "", resale: "" };
  try {
    const raw = readFileSync(
      join(__dirname, "../lib/contracts/addresses.local.json"),
      "utf-8",
    );
    addresses = JSON.parse(raw);
  } catch {
    console.warn("addresses.local.json not found — run `forge script` first");
  }

  // Admin user
  const admin = await prisma.user.upsert({
    where: { privyId: "local-admin" },
    create: {
      privyId: "local-admin",
      email: "admin@shaar.local",
      walletAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      role: UserRole.ADMIN,
    },
    update: {},
  });

  // Organizer user
  const orgUser = await prisma.user.upsert({
    where: { privyId: "local-organizer" },
    create: {
      privyId: "local-organizer",
      email: "org@shaar.local",
      walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      role: UserRole.ORGANIZER,
    },
    update: {},
  });

  const organizer = await prisma.organizer.upsert({
    where: { userId: orgUser.id },
    create: {
      userId: orgUser.id,
      companyName: "Produtora Exemplo Ltda",
      document: "00.000.000/0001-00",
      payoutWallet: orgUser.walletAddress!,
      status: OrganizerStatus.APPROVED,
    },
    update: {},
  });

  // Sample event
  await prisma.event.upsert({
    where: { id: "seed-event-1" },
    create: {
      id: "seed-event-1",
      organizerId: organizer.id,
      title: "Show Exemplo — Dev Local",
      description: "Evento de seed para desenvolvimento local.",
      venue: "Arena Teste",
      city: "São Paulo",
      eventDate: new Date("2026-12-01T20:00:00Z"),
      ticketPriceUsdc: 45.0,
      maxTickets: 500,
      platformFeeBps: 800,
      royaltyBps: 1000,
      royaltyOrgShareBps: 8000,
      status: EventStatus.ON_SALE,
    },
    update: {},
  });

  // Seed sync_state for deployed contracts
  if (addresses.sale) {
    for (const addr of [addresses.sale, addresses.resale]) {
      if (!addr) continue;
      await prisma.syncState.upsert({
        where: { contractAddress: addr },
        create: { contractAddress: addr, lastProcessedBlock: 0n },
        update: {},
      });
    }
  }

  console.log("Seed complete.", { admin: admin.id, organizer: organizer.id });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
