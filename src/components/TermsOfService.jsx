const sectionStyle = { marginBottom: 28 };
const headingStyle = { margin: "0 0 10px", fontSize: 20, lineHeight: 1.4, color: "#0f172a" };
const paragraphStyle = { margin: "0 0 10px", color: "#334155", lineHeight: 1.75 };
const listStyle = { margin: "8px 0 0", paddingLeft: 22, color: "#334155", lineHeight: 1.8 };

export default function TermsOfService() {
  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a", fontFamily: "'Pretendard','DM Sans',Arial,sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "56px 24px 72px" }}>
        <header style={{ marginBottom: 44 }}>
          <a href="/" style={{ color: "#1d4ed8", textDecoration: "none", fontSize: 14, fontWeight: 700 }}>PROPOS</a>
          <h1 style={{ margin: "18px 0 10px", fontSize: 34, lineHeight: 1.25 }}>서비스 이용약관</h1>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>시행일: 2026년 10월 17일</p>
        </header>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>1. 목적</h2>
          <p style={paragraphStyle}>이 약관은 PROPOS(이하 “서비스”)의 이용 조건과 운영자 및 이용자의 권리·의무를 정하는 것을 목적으로 합니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>2. 서비스의 내용</h2>
          <p style={paragraphStyle}>서비스는 숙소 운영을 위해 예약 일정, 청소 일정, 담당자 배정 및 운영 리포트를 조회·관리하는 기능을 제공합니다. 서비스의 구체적인 기능과 제공 범위는 운영상 필요에 따라 변경될 수 있습니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>3. 이용자의 계정과 권한</h2>
          <ul style={listStyle}>
            <li>이용자는 본인의 계정과 인증 정보를 안전하게 관리해야 합니다.</li>
            <li>이용자는 서비스 이용 권한을 다른 사람에게 양도하거나 공유해서는 안 됩니다.</li>
            <li>계정의 무단 사용이나 보안 문제가 의심되면 즉시 운영자에게 알려야 합니다.</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>4. Google 계정 및 외부 서비스 연동</h2>
          <p style={paragraphStyle}>서비스는 이용자가 승인한 범위에서 Google Calendar 및 Gmail API와 연동될 수 있습니다. 이용자는 Google의 관련 약관과 정책도 준수해야 하며, Google 계정의 권한을 철회하면 해당 연동 기능의 일부 또는 전부를 이용할 수 없게 될 수 있습니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>5. 이용자의 의무</h2>
          <ul style={listStyle}>
            <li>법령, Google 정책 또는 제3자의 권리를 침해하는 방식으로 서비스를 이용해서는 안 됩니다.</li>
            <li>서비스의 정상적인 운영을 방해하거나, 허가 없이 시스템에 접근하거나, 다른 이용자의 데이터를 훼손해서는 안 됩니다.</li>
            <li>서비스에 입력하거나 연동하는 정보에 필요한 권한이 있는지 이용자가 확인해야 합니다.</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>6. 데이터와 개인정보</h2>
          <p style={paragraphStyle}>서비스는 이용자가 제공하거나 연동을 승인한 정보를 약관과 개인정보처리방침에 따라 처리합니다. 개인정보의 처리 목적, 보관, 삭제 및 Google 사용자 데이터의 이용에 관한 사항은 <a href="/privacy-policy">개인정보처리방침</a>에서 확인할 수 있습니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>7. 서비스의 변경 및 중단</h2>
          <p style={paragraphStyle}>운영자는 보안, 기술, 법령 또는 운영상의 사유로 서비스의 전부 또는 일부를 변경하거나 일시 중단할 수 있습니다. 예정된 변경이나 중단이 이용자에게 중대한 영향을 주는 경우 가능한 범위에서 사전에 안내합니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>8. 책임의 제한</h2>
          <p style={paragraphStyle}>서비스는 제공되는 정보를 운영 지원 목적으로 제공하며, 예약·청소 업무의 최종 확인과 실행 책임은 이용자에게 있습니다. 운영자는 천재지변, 외부 서비스 장애, 이용자의 귀책사유 등 합리적으로 통제하기 어려운 사유로 발생한 손해에 대해 관련 법령이 허용하는 범위에서 책임을 지지 않습니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>9. 이용 제한 및 해지</h2>
          <p style={paragraphStyle}>이용자가 약관이나 관련 법령을 위반하거나 서비스의 안전한 운영을 위협하는 경우 운영자는 이용을 제한하거나 계정을 해지할 수 있습니다. 이용자는 Google 계정 권한을 철회하거나 운영자에게 이용 중단을 요청할 수 있습니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>10. 약관의 변경</h2>
          <p style={paragraphStyle}>운영자는 법령이나 서비스 변경에 따라 약관을 수정할 수 있습니다. 변경된 약관은 이 페이지에 게시한 날부터 효력이 발생하며, 중요한 변경은 가능한 범위에서 별도로 안내합니다.</p>
        </section>

        <section style={{ ...sectionStyle, marginBottom: 0 }}>
          <h2 style={headingStyle}>11. 문의</h2>
          <p style={paragraphStyle}>서비스 이용약관에 대한 문의: <a href="mailto:adcfirm@gmail.com">adcfirm@gmail.com</a></p>
        </section>
      </div>
    </main>
  );
}
