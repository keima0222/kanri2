-- Authentication > Users でご本人の利用者を作成した後に実行します。
-- 下の「ここに自分のメールアドレス」を、その利用者のメールアドレスに置き換えてください。
do $$
declare selected_user uuid;
begin
 select id into selected_user from auth.users
 where lower(email)=lower('ここに自分のメールアドレス');
 if selected_user is null then
  raise exception '利用者が見つかりません。Authentication > Users とメールアドレスを確認してください。';
 end if;
 insert into public.hoan_owners(user_id) values(selected_user) on conflict do nothing;
end;
$$;
