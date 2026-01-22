use anchor_lang::prelude::*;

declare_id!("9SUAHZ5CLyv6BdfGQLdb15KE1DanR9m6TdqHbq7ZaQWG");
mod error;
mod instructions;
mod state;
use instructions::deposit::*;
use instructions::initialize_vault::*;
use instructions::withdraw::*;
#[program]
pub mod inco_private_funding {

    use super::*;
    pub fn initialize<'info>(ctx: Context<InitializeVault>) -> Result<()> {
        initialize_vault(ctx)?;
        Ok(())
    }
    pub fn deposit<'info>(
        ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
        amount: Vec<u8>,
    ) -> Result<()> {
        deposit_vault(ctx, amount)?;
        Ok(())
    }
    pub fn withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, WithdrawAccounts<'info>>,
        amount: Vec<u8>,
    ) -> Result<()> {
        withdraw_amount(ctx, amount)?;
        Ok(())
    }
}
