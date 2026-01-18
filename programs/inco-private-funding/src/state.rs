use anchor_lang::prelude::*;
use inco_lightning::types::Euint128;
#[account]
pub struct Funding {
    pub creator: Pubkey,            // Vault creator/owner
    pub vault_ata: Pubkey,          // Address of vault ATA PDA
    pub mint: Pubkey,               // Token mint
    pub enc_total_raised: Euint128, // Encrypted total
    pub contributor_count: u64,     // Number of contributors
    pub created_at: i64,            // Unix timestamp
    pub is_finalized: bool,         // Fundraise status
}

impl Funding {
    pub const LEN: usize = 32 + 32 + 32 + 16 + 1 + 32 + 8 + 8 + 1;
}
