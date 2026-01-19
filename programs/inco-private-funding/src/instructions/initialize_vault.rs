use anchor_lang::prelude::*;
use inco_lightning::cpi::Operation;
use inco_lightning::IncoLightning;
use inco_lightning::{cpi::as_euint128, types::Euint128};

use crate::state::Funding;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(init, payer=signer,space=8+Funding::LEN,seeds = [b"vault-1", signer.key().as_ref()], bump)]
    pub funding: Account<'info, Funding>,
    /// Encrypted token account owned by the funding PDA
    /// Initialized via CPI to the Inco Token program
    #[account(
           mut,
           seeds = [
               b"vault-ata-1",
               funding.key().as_ref(),
               mint.key().as_ref(),
           ],
           bump
       )]
    ///CHECK:Vault confidential token account (created via CPI)
    pub vault_ata: AccountInfo<'info>,
    /// CHECK:Mint Account
    pub mint: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Inco Lightning program
    #[account(address = IncoLightning::id())]
    pub inco_lightning_program: Program<'info, IncoLightning>,
    /// CHECK: Inco Token program
    pub inco_token_program: AccountInfo<'info>,
}

pub fn initialize_vault<'info>(
    ctx: Context<'_, '_, '_, 'info, InitializeVault<'info>>,
) -> Result<()> {
    let funding = &mut ctx.accounts.funding;
    let mint = &ctx.accounts.mint;
    let inco = ctx.accounts.inco_token_program.to_account_info();
    let cpi_accounts = inco_token::cpi::accounts::InitializeAccount {
        account: ctx.accounts.vault_ata.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        owner: funding.to_account_info(),
        payer: ctx.accounts.signer.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        inco_lightning_program: ctx.accounts.inco_lightning_program.to_account_info(),
    };

    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault-ata-1",
        funding.to_account_info().key.as_ref(),
        ctx.accounts.mint.to_account_info().key.as_ref(),
        &[ctx.bumps.vault_ata],
    ]];

    let cpi_ctx = CpiContext::new(inco.clone(), cpi_accounts).with_signer(signer_seeds);

    inco_token::cpi::initialize_account(cpi_ctx)?;
    let cpi_ctx = CpiContext::new(
        ctx.accounts.inco_lightning_program.to_account_info(),
        Operation {
            signer: ctx.accounts.signer.to_account_info(),
        },
    );

    // Create encrypted zero
    let zero_handle: Euint128 = as_euint128(cpi_ctx, 0)?;
    funding.set_inner(Funding {
        creator: *ctx.accounts.signer.key,
        enc_total_raised: zero_handle,
        contributor_count: 0,
        created_at: Clock::get()?.unix_timestamp,
        is_finalized: false,
        vault_ata: ctx.accounts.vault_ata.key(),
        mint: mint.key(),
    });

    Ok(())
}
