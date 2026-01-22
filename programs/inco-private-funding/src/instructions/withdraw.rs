use anchor_lang::prelude::*;
use inco_lightning::cpi::{allow, e_sub, new_euint128, Allow, Operation};
use inco_lightning::{Euint128, IncoLightning};
use inco_token::IncoAccount;

use crate::error::CustomError;
use crate::state::Funding;
use inco_token::cpi::{accounts::IncoTransfer, transfer};
#[derive(Accounts)]
pub struct WithdrawAccounts<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,
    #[account(mut)]
    ///CHECK:Destination confidential token account
    pub withdraw_account: AccountInfo<'info>,
    #[account(mut,seeds = [
        b"vault-ata-1",
        funding.key().as_ref(),
        funding.mint.as_ref(),
    ],
    bump)]
    ///CHECK:Vault confidential token account
    pub vault_account: AccountInfo<'info>,
    #[account(mut,seeds = [b"vault-1", taker.key().as_ref()], bump)]
    pub funding: Account<'info, Funding>,
    /// CHECK: Inco Lightning program
    #[account(address = IncoLightning::id())]
    pub inco_lightning_program: Program<'info, IncoLightning>,
    /// CHECK: Inco Token program
    pub inco_token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}
pub fn withdraw_amount<'info>(
    ctx: Context<'_, '_, '_, 'info, WithdrawAccounts<'info>>,
    amount: Vec<u8>,
) -> Result<()> {
    let taker = ctx.accounts.taker.key();
    // Only campaign creator can withdraw
    require!(
        ctx.accounts.taker.key() == ctx.accounts.funding.creator.key(),
        CustomError::OwnerMismatch
    );

    // Transfer confidential tokens (vault -> creator)
    let funding_seeds = &[b"vault-1", taker.as_ref(), &[ctx.bumps.funding]];
    let signer_seeds: &[&[&[u8]]] = &[funding_seeds];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.inco_token_program.to_account_info(),
        IncoTransfer {
            source: ctx.accounts.vault_account.to_account_info(),
            destination: ctx.accounts.withdraw_account.to_account_info(),
            authority: ctx.accounts.funding.to_account_info(),
            inco_lightning_program: ctx.accounts.inco_lightning_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        },
        signer_seeds,
    );
    transfer(transfer_ctx, amount.clone(), 0)?;
    // Create encrypted amount handle
    let cpi_ctx = CpiContext::new(
        ctx.accounts.inco_lightning_program.to_account_info(),
        Operation {
            signer: ctx.accounts.taker.to_account_info(),
        },
    );

    let encrypted_amount: Euint128 = new_euint128(cpi_ctx, amount, 0)?;

    let cpi_ctx = CpiContext::new(
        ctx.accounts.inco_lightning_program.to_account_info(),
        Operation {
            signer: ctx.accounts.taker.to_account_info(),
        },
    );
    let updated_total = e_sub(
        cpi_ctx,
        Euint128(ctx.accounts.funding.enc_total_raised),
        encrypted_amount,
        0,
    )?;
    ctx.accounts.funding.enc_total_raised = updated_total.0;
    msg!("   Updated funding handle: {}", updated_total.0);
    if ctx.remaining_accounts.len() >= 2 {
        let allow_ctx = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            Allow {
                allowance_account: ctx.remaining_accounts[0].to_account_info(),
                signer: ctx.accounts.taker.to_account_info(),
                allowed_address: ctx.remaining_accounts[1].to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        );
        let vault_state =
            IncoAccount::try_deserialize(&mut &ctx.accounts.vault_account.data.borrow()[..])?;

        allow(
            allow_ctx,
            vault_state.amount.0,
            true,
            ctx.accounts.taker.key(),
        )?;
    }
    if ctx.remaining_accounts.len() >= 4 {
        let allow_ctx = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            Allow {
                allowance_account: ctx.remaining_accounts[2].to_account_info(),
                signer: ctx.accounts.taker.to_account_info(),
                allowed_address: ctx.remaining_accounts[3].to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        );
        allow(allow_ctx, updated_total.0, true, ctx.accounts.taker.key())?;
    }
    Ok(())
}
