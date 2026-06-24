-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BUYER', 'ORGANIZER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "OrganizerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ON_SALE', 'PAUSED', 'ENDED', 'FROZEN', 'REJECTED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('VALID', 'LISTED', 'CHECKED_IN', 'FROZEN');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'LOCKED', 'CANCELLING', 'SOLD', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CARD', 'USDC');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'PAID', 'MINTING', 'COMPLETED', 'REFUNDING', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "privy_id" TEXT NOT NULL,
    "email" TEXT,
    "wallet_address" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'BUYER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "payout_wallet" TEXT NOT NULL,
    "status" "OrganizerStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "organizer_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "venue" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "cover_image_url" TEXT,
    "event_date" TIMESTAMP(3) NOT NULL,
    "ticket_price_usdc" DECIMAL(18,6) NOT NULL,
    "max_tickets" INTEGER,
    "platform_fee_bps" INTEGER NOT NULL DEFAULT 800,
    "royalty_bps" INTEGER NOT NULL DEFAULT 1000,
    "royalty_org_share_bps" INTEGER NOT NULL DEFAULT 8000,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "onchain_event_id" INTEGER,
    "royalty_splitter_address" TEXT,
    "create_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "token_id" INTEGER NOT NULL,
    "event_id" TEXT NOT NULL,
    "owner_address" TEXT NOT NULL,
    "ticket_number" INTEGER NOT NULL,
    "seat" TEXT,
    "face_price" DECIMAL(18,6) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'VALID',
    "mint_tx_hash" TEXT,
    "minted_at" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("token_id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "onchain_listing_id" INTEGER,
    "token_id" INTEGER NOT NULL,
    "seller_address" TEXT NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "payment_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "token_id" INTEGER,
    "amount_brl" DECIMAL(10,2) NOT NULL,
    "amount_usdc" DECIMAL(18,6) NOT NULL,
    "fx_rate" DECIMAL(10,6) NOT NULL,
    "psp_provider" TEXT,
    "psp_charge_id" TEXT NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "mint_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "amount_brl" DECIMAL(10,2) NOT NULL,
    "fx_rate" DECIMAL(10,6) NOT NULL,
    "pix_key" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "usdc_transfer_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkins" (
    "id" TEXT NOT NULL,
    "token_id" INTEGER NOT NULL,
    "event_id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "contract_address" TEXT NOT NULL,
    "last_processed_block" BIGINT NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("contract_address")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_privy_id_key" ON "users"("privy_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "organizers_user_id_key" ON "organizers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_event_id_ticket_number_key" ON "tickets"("event_id", "ticket_number");

-- CreateIndex
CREATE UNIQUE INDEX "listings_onchain_listing_id_key" ON "listings"("onchain_listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "listings_token_id_key" ON "listings"("token_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_token_id_key" ON "purchases"("token_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_psp_charge_id_key" ON "purchases"("psp_charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkins_token_id_key" ON "checkins"("token_id");

-- AddForeignKey
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tickets"("token_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tickets"("token_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tickets"("token_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
