select cron.schedule('cuban-league-official-xi','* * * * *','select forecast_history.tick_xi()');
